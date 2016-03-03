var Client = require('ftp');
var fs = require('fs');
var chokidar = require('chokidar');
var anymatch=require('anymatch');
var pathUtil=require('path');
var util = require("util");  
var events = require("events"); 

Date.prototype.format = function (fmt) { //author: meizz 
	var o = {
	    "M+": this.getMonth() + 1, //月份 
	    "d+": this.getDate(), //日 
	    "h+": this.getHours(), //小时 
	    "m+": this.getMinutes(), //分 
	    "s+": this.getSeconds(), //秒 
	    "q+": Math.floor((this.getMonth() + 3) / 3), //季度 
	    "S": this.getMilliseconds() //毫秒 
	};
	if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
	for (var k in o)
	if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
	return fmt;
}

function getFtpConfig(config){
	return {
		pasvTimeout :(config.pasvTimeout||30)*1000,
		connTimeout :(config.connTimeout||10)*1000,
		keepalive :(config.keepalive||60)*1000,
		host:config.host,
		port:parseInt(config.port)||21,
		user:config.user,
		password:config.password,
		secure:config.secure,
		secureOptions:config.secureOptions
	}
}

function FtpSync(){
	events.EventEmitter.call(this);  
	this._config=null;
	this.$works=[];
	this.$currentWork=null;

}
util.inherits(FtpSync, events.EventEmitter);

FtpSync.prototype.config=function(config){
	if(arguments.length==0)return this._config;

	this._config=getFtpConfig(config);
	this.excludes=config.excludes||[];
	this.includes=config.includes||[];
	var works=config.works;
	if(works){
		for(var i=0,n=works.length;i<n;i++){
			var cfg=works[i];
			if(cfg.clientPath===undefined || cfg.serverPath===undefined||cfg.enabled===false){
				continue;
			}
			this.addWork(cfg,config.activeAll&&cfg.enabled!==false);
			// var w=new FtpWork(this,cfg);
			// this.$works.push(w);
			// this[w.name]=w;
			// if(config.activeAll&&w.enabled!==false)
			// 	w.connect();
		}

	}
}

FtpSync.prototype.addWork=function(config,active){
	if(!config.name){
		throw "need config.name";		
	}
	if(config.clientPath===undefined || config.serverPath===undefined){
		throw "need config.clientPath and config.serverPath";
	}
	if(this[config.name]){
		throw "work named "+config.name+" already exists!";
	}
	var w=new FtpWork(this,config);
	this.$works.push(w);
	this[w.name]=w;
	if(active)w.connect();
}

FtpSync.prototype.removeWork=function(name){
	var w=this[name];
	if(w){
		delete this[name];
		var index=-1;
		for(var i=0,n=this.$works.length;i<n;i++){
			if(this.$works[i]===w){
				index=i;
				break;
			}
		}
		if(index>-1){
			this.$works.splice(index,1);
		}
	}
}

FtpSync.prototype.closeAll=function(){
	for(var i=0,n=this.$works.length;i<n;i++){
		this.$works[i].close();
	}
}

FtpSync.prototype.works=function(){
	return this.$works;
}

FtpSync.prototype.worksName=function(){
	var names=[];
	for(var i=0,n=this.$works.length;i<n;i++){
		names.push(this.$works[i].name);
	}
	return names;
}

FtpSync.prototype.changes=function(raw){
	
	var works=this.$works;
	
	if(raw){
		var result={};
		for(var i=0,n=works.length;i<n;i++){
			result[works[i].name]=works[i].$changedFiles;
		}
		return result;
	} else {
		for(var i=0,n=works.length;i<n;i++){
			works[i].changes();
		}
	}
}

FtpSync.prototype.upload=function(){
	var works=this.$works;
	for(var i=0,n=works.length;i<n;i++){
		works[i].upload();
	}
}

function FtpWork(ftpsync,config){
	this.ftpSync=ftpsync;
	this.enabled=config.enabled!==false;
	this.clientPath=config.clientPath||"./";
	this.serverPath=config.serverPath||"/";
	this.autoUpload=config.autoUpload;
	if(config.host){
		this.config=getFtpConfig(config);
	} else {
		this.config=ftpsync._config;
	}
	this.excludes=config.excludes||ftpsync.excludes;
	this.includes=config.includes||ftpsync.includes;

	this.name=config.name;
	this.state="init";
	this.client=null;
	var self=this;
	this._workFile=".works/"+this.name+".json";
	var hasWorkFile=fs.existsSync(this._workFile);

	try{
		this.$changedFiles=hasWorkFile?(JSON.parse(fs.readFileSync(this._workFile,'utf8'))||{}):{};	
	}catch(e){
		this.$changedFiles={};		
	}
	
	this.$readyTasks=[];
	this.$uploadSeries=[];
	this.start(config);//开始文件监听
}
FtpWork.prototype.toString=function(){
	return this.name+":ftp"+"{state="+this.state+",host="+
	this.config.host+":"+this.config.port+
	",clientPath="+this.clientPath+",serverPath="+this.serverPath+"}";
}
//开始文件监听
FtpWork.prototype.start=function(config){
	if(this._fsWatcher)return;
	config=config||{};
	var self=this;
	var hasWorkFile=fs.existsSync(this._workFile);
	this._fsWatcher=chokidar.watch(this.clientPath,
		///工作文件存在时强制忽略
		{ignoreInitial:hasWorkFile||config.ignoreInitial});
	this._fsWatcher.on(
		"all",
		function(event,path){
			path=pathUtil.relative(self.clientPath,path);
			var includes=self.includes;
			var excludes=self.excludes;
			var ignored=false;
			for(var i=0,n=excludes.length;i<n;i++){
				if( anymatch(excludes[i],path)){
					ignored=true;
					for(var i=0,n=includes.length;i<n;i++){
						if(anymatch(includes[i],path)){
							ignored=false;
							break;
						}
					}
					break;
				}
			}

			if(ignored)return;
			ftpSync.log(self.name+" local file "+event,":",path);
			self.ftpSync.emit("change",self,path,event);
			var client=self.client;
			var changedFile=self.$changedFiles;
				changedFile[path]=event;
			if(self.autoUpload){
				self.upload(path,event);
			}
			
	});

	this.ftpSync.emit("start",this);
}
FtpWork.prototype._setUpClient=function(){
	if(!this.client){
		var client=this.client=new Client();	
		var self=this;
		this.client.on("greeting",function(msg){
			self.state="greeting";
			self.ftpSync.emit("state",self);
			console.log(self.name,"ftp greeting",msg);
		});
		this.client.on("ready",function(){
			self.state="ready";	
			self.ftpSync.emit("state",self);		
			ftpSync.log(self.name,"ftp ready");
			client.mkdir(self.serverPath,function(err){
				if(err)
					ftpSync.log("create serverPath:"+self.serverPath,err);
			
				client.cwd(self.serverPath,function(err,dir){
					if(err){
						ftpSync.log(self.name,'cwd',dir,'error',err);
						self.close();
						return;
					}
					ftpSync.log(self.name,"sync",self.clientPath,"to",dir);
					while(self.$readyTasks.length>0){
						var task=self.$readyTasks.shift();
						task[0].apply(self,task[1]);
					}
				});
			});
			
		});
		this.client.on('error',function(err){
			if(self.state=='greeting'){
				self.state="error";
				self.ftpSync.emit("state",self);
			}
			ftpSync.log(self.name,"ftp error",err)
		});
		this.client.on("close",function(hadErr){
			self.state="close";
			ftpSync.log(self.name,"ftp closed","hadErr:"+hadErr);
			self.ftpSync.emit("state",self);
		});
		this.client.on("end",function(){
			self.state="close"
			ftpSync.log(self.name,"ftp ended")
			self.ftpSync.emit("state",self);
		});
	}
}

FtpWork.prototype.ensureReady=function(task,args){
	if(this.state=='ready'){
		return true;
	}
	if(typeof task==='function')
		this.$readyTasks.push([task,args]);
	if(this.state!='greeting'&&this.state!=='ready')
		this.connect();
	return false;
}
/**
 * 连接ftp
**/
FtpWork.prototype.connect=function(){
	this._setUpClient();
	if(this.state=='ready'||this.state=='greeting'){
		return;
	}
	this.ftpSync.emit("beforeConnect",this);
	this.client.connect(this.config);
}
/**
* 停止文件监听
*/
FtpWork.prototype.stop=function(){
	this._fsWatcher&&this._fsWatcher.close();
	this._fsWatcher=null;
	this.ftpSync.emit("stop",this);
}
/**
  *关闭ftp
 */
FtpWork.prototype.close=function(){
	if(this.client)
		this.client.destroy();

	var changes=JSON.stringify(this.$changedFiles);
	fs.writeFileSync(".works/"+this.name+".json",changes);
}

FtpWork.prototype.listServer=function(path,useCompress,callback){
	if(this.ensureReady(this.listServer,[path,useCompress,callback])){		
		var self=this;
		var lpath=this.serverPath+"/"+(path||'');
		this.client.list(lpath,useCompress,callback||function(err,list){

			if(err){
				ftpSync.error(self.name+".list error:",err);
				return;
			}
			var result=[];
			for(var i=0,n=list.length;i<n;i++){
				var fn=list[i];
				result.push(" "+fn.type+'\t'+
					fn.size+'\t'+fn.name+'\t'+					
					fn.date.format("yyyy-MM-dd hh:mm:ss.S"));
			}
			console.log("server list",lpath,":");
			ftpSync.log(result.join("\n"))
		});
	}
}
FtpWork.prototype.listLocal=function(path,callback){
	var lpath=this.clientPath+"/"+(path||'');
	files = fs.readdir(lpath,callback||function(err,files){
		if(err){
			ftpSync.log(err);
			return ;
		}
		var fileList=[];
	 	files.forEach(function (file) {
			var info="";
			states = fs.statSync(lpath+'/'+file); 
			if(states.isDirectory()){
				info+="d\t";
			} else { 
				info+="-\t";
			}  
			info+=states.size+"\t"+file+"\t"+states.mtime.format("yyyy-MM-dd hh:mm:ss.S");
			fileList.push(info);
	 	});
	 	ftpSync.log(lpath+":\n"+fileList.join("\n"));
	});	 
}
FtpWork.prototype.changes=function(raw){
	var changes=JSON.stringify(this.$changedFiles);
	fs.writeFileSync(".works/"+this.name+".json",changes);
	for(var p in this.$changedFiles){
		var event=this.$changedFiles[p];
		console.log(this.name,":",event,p);
	}	
	if(raw)
		return changes;
}
FtpWork.prototype.add=function(path){
	var fullpath=this.clientPath+"/"+path;
	var stat=fs.statSync(fullpath);
	if(stat.isFile()){
		this.$changedFiles[path]="change";
	}else if(stat.isDirectory()){
		this.$changedFiles[path]="addDir";
		var files = fs.readdirSync(fullpath);
		for(var i=0,n=files.length;i<n;i++){
			var file=files[i];
			if(file=='.'||file=='..')continue;
			this.add(path+"/"+file);
		}
	}
}
FtpWork.prototype.clear=function(){
	return this.$changedFiles={};
}
/**

*/
FtpWork.prototype.upload=function(path,event){
	var args=arguments.length==0?[]:[path,event];
	if(this.ensureReady(this.upload,args)){
		
		if(arguments.length==0){
			for(var p in this.$changedFiles){
				var event=this.$changedFiles[p];
				this._upload(p,event);				
			}			
		} else {

			this._upload(path,event);	
		}
		if(this.$uploadSeries.length==0)return;
		this.$failedUpdate=this.$failedUpdate||[];
		this._doNextUpload();
	}
}

FtpWork.prototype._upload=function(path,event){
	this.$uploadSeries.push({path:path,event:event,trycount:0});
}

FtpWork.prototype._doNextUpload=function(){
	var uploadData=this.$uploadSeries.shift();
	if(!uploadData){
		this.onAllUploadComplete&&this.onAllUploadComplete();
		return true;
	}
	uploadData.trycount++;
	if(uploadData.trycount>3){
		this.$failedUpdate.push(uploadData);
		this._doNextUpload();
		return;
	}
	console.log("do uppload:",uploadData);
	var path=uploadData.path;
	var event=uploadData.event;

	var client=this.client;
	var comp=this.useCompress;
	var self=this; 
	var localPath=this.clientPath+'/'+path;
	//var relativePath=pathUtil.relative(this.clientPath,path);
	var remotePath=pathUtil.normalize(this.serverPath+'/'+path);
	var remoteDir=pathUtil.dirname(remotePath);
	var remoteName=pathUtil.basename(remotePath);
	switch(event){
		case 'change':				
		case 'add':
		client.cwd(remoteDir,function(err){
			if(err){
				ftpSync.log("cwd",remoteDir,"error",err);
				if(err.indexOf('directory not found')){
					//父目录不存在，放到链尾再试三次，
					//self.$uploadSeries.pop(uploadData);
					self.$uploadSeries.pop(uploadData);
					self._doNextUpload();	
				}
			}else{
				client.put(localPath,
					remoteName,
					comp,
					function(err){
						if(err){
							ftpSync.log("put",path,"error",err)
							self.$failedUpdate.push(uploadData);
						} else {
							ftpSync.log('put',path,"success");
							self.$changedFiles[path]&&delete self.$changedFiles[path];
						}
						self._doNextUpload();
					}
				);
			}
		});
		break;
		case 'addDir':
		client.mkdir(remotePath,
			true,
			function(err){
				if(err){
					ftpSync.log("mkdir",path,"error",err);
					self.$failedUpdate.push(uploadData);
				}
				else{
					ftpSync.log("mkdir",path,"success");
					self.$changedFiles[path]&&delete self.$changedFiles[path];
				}
				self._doNextUpload();
		});
		break;
		case "unlink":
		client.delete(remotePath,
			function(err){
				if(err){
					ftpSync.log("remove",path,"error",err);
					self.$failedUpdate.push(uploadData);
				}
				else {
					self.$changedFiles[path]&&delete self.$changedFiles[path];
					ftpSync.log("remove",path,"success");
				}
				self._doNextUpload();
		});
		break;
		case "unlinkDir":
		client.rmdir(remotePath,
			true,
			function(err){
				if(err){
					ftpSync.log("remove",path,"error",err);
					self.$failedUpdate.push(uploadData);
				}
				else {
					self.$changedFiles[path]&&delete self.$changedFiles[path];
					ftpSync.log("remove",path,"success");
				}
				self._doNextUpload();

		});
		break;
		default:
			self._doNextUpload();
			break;
	}
	return false;
}

FtpWork.prototype.onAllUploadComplete=function(){
	ftpSync.log(this.name,":","All upload complete");
	console.log(this.name,":","faild count",this.$failedUpdate.length);
	this.ftpSync.emit("uploaded",this,this.$failedUpdate);
	this.$failedUpdate=[];
}

FtpWork.prototype.download=function(path){
	//
	ftpSync.log("unimplemented");
}

FtpWork.prototype._download=function(){
	ftpSync.log("unimplemented");
}



var ftpSync=new FtpSync();
ftpSync.log=ftpSync.error=function(){
	console.log.call(console,arguments);
}

module.exports=ftpSync;