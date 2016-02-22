var Client = require('ftp');
var fs = require('fs');
var chokidar = require('chokidar');
var anymatch=require('anymatch');
var pathUtil=require('path');

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
	this._config=null;
	this.$works=[];
	this.$currentWork=null;

}

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
			var w=new FtpWork(this,cfg);
			this.$works.push(w);
			this[w.name]=w;
			if(config.activeAll&&w.enabled!==false)
				w.connect();
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

FtpSync.prototype.current=function(){
	return this.$currentWork;
}

function FtpWork(ftpsync,config){
	this.ftpSync=ftpsync;
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
	
	this.$tasks=[];
	this.start(config);//开始文件监听
}
FtpWork.prototype.toString=function(){
	return this.name+":"+this.state+"{"+this.config.host+":"+this.port+"}";
}
//开始文件监听
FtpWork.prototype.start=function(config){
	if(this._fsWatcher)return;
	var self=this;
	var hasWorkFile=fs.existsSync(this._workFile);
	this._fsWatcher=chokidar.watch(this.clientPath,
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
			var client=self.client;
			var changedFile=self.$changedFiles;
				changedFile[path]=event;
			if(self.autoUpload){
				self.upload(path,event);
			}
			
	});
}
FtpWork.prototype.setUpClient=function(){
	if(!this.client){
		this.client=new Client();	
		var self=this;
		this.client.on("greeting",function(msg){
			self.state="greeting";
			ftpSync.log(self.name,"ftp greeting",msg);
		});
		this.client.on("ready",function(){
			self.state="ready";			
			ftpSync.log(self.name,"ftp ready");
			this.mkdir(self.serverPath,function(err){
				if(err)
					ftpSync.log("create serverPath:"+self.serverPath,err);
			});
			this.cwd(self.serverPath,function(err,dir){
				if(err){
					ftpSync.log(self.name,'cwd',dir,'error',err);
					self.close();
					return;
				}
				ftpSync.log(self.name,"sync",self.clientPath,"to",dir);
			});
			while(self.$tasks.length>0){
				var task=self.$tasks.pop();
				task[0].apply(self,task[1]);
			}
		});
		this.client.on('error',function(err){
			if(self.state=='greeting'){
				self.state="error";
			}
			ftpSync.log(self.name,"ftp error",err)
		});
		this.client.on("close",function(hadErr){
			self.state="close";
			ftpSync.log(self.name,"ftp closed","hadErr:"+hadErr);
		});
		this.client.on("end",function(){
			self.state="close"
			ftpSync.log(self.name,"ftp ended")
		});
	}
}
FtpWork.prototype.checkReady=function(task,args){
	if(this.state=='ready'){
		return true;
	}
	if(typeof task==='function')
		this.$tasks.push([task,args]);
	if(this.state!='greeting'&&this.state!=='ready')
		this.connect();
	return false;
}
/**
 * 连接ftp
**/
FtpWork.prototype.connect=function(){
	this.setUpClient();
	if(this.state=='ready'||this.state=='greeting'){
		return;
	}
	ftpSync.log(this.name+" is connecting",this.config);
	this.client.connect(this.config);
}
/**
* 停止文件监听
*/
FtpWork.prototype.stop=function(){
	this._fsWatcher&&this._fsWatcher.close();
	this._fsWatcher=null;
}
/**
  *关闭ftp
 */
FtpWork.prototype.close=function(){

	this._fsWatcher.close();

	if(this.client)
		this.client.destroy();

	var changes=JSON.stringify(this.$changedFiles);
	fs.writeFileSync(".works/"+this.name+".json",changes);
}

FtpWork.prototype.listServer=function(path,useCompress){
	if(this.checkReady(this.listServer,[path,useCompress])){		
		var self=this;
		var lpath=this.serverPath+"/"+(path||'');
		this.client.list(lpath,useCompress,function(err,list){
			if(err){
				ftpSync.error(self.name+".list error:",err);
				return;
			}
			ftpSync.log("server list",lpath,":");

			for(var i=0,n=list.length;i<n;i++){
				var fn=list[i];
				ftpSync.log(fn.type,'\t',
					//fn.rights.user,'\t',fn.rights.group,'\t',fn.rights.other,'\t',
					fn.size,'\t',fn.name,'\t',					
					fn.date.format("yyyy-MM-dd hh:mm:ss.S"));
			}
		});
	}
}
FtpWork.prototype.listLocal=function(path){
	var lpath=this.clientPath+"/"+(path||'');


}
FtpWork.prototype.changes=function(){
	var changes=JSON.stringify(this.$changedFiles);
	fs.writeFileSync(".works/"+this.name+".json",changes);
	return changes;
}
FtpWork.prototype.clear=function(){
	return this.$changedFiles={};
}
/**

*/
FtpWork.prototype.upload=function(path,event){
	if(this.checkReady(this.upload,[path,event])){
		
		if(arguments.length==0){
			for(var p in this.$changedFiles){
				var event=this.$changedFiles[p];
				this._upload(p,event);				
			}			
		} else {
			this._upload(path,event);	
		}
	}
}
FtpWork.prototype._upload=function(path,event){
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
			}else	client.put(localPath,
				remoteName,
				comp,
				function(err){
					if(err)ftpSync.log("put",path,"error",err)
					else {
						ftpSync.log('put',path,"success");
						self.$changedFiles[path]&&delete self.$changedFiles[path];
					}
				}
			);

		});
		break;
		case 'addDir':
		client.mkdir(remotePath,
			true,
			function(err){
				if(err)
					ftpSync.log("mkdir",path,"error",err);
				else{
					ftpSync.log("mkdir",path,"success");
					self.$changedFiles[path]&&delete self.$changedFiles[path];
				}
		});
		break;
		case "unlink":
		client.delete(remotePath,
			function(err){
				if(err)
					ftpSync.log("remove",path,"error",err);
				else {
					self.$changedFiles[path]&&delete self.$changedFiles[path];
					ftpSync.log("remove",path,"success");
				}
		});
		break;
		case "unlinkDir":
		client.rmdir(remotePath,
			true,
			function(err){
				if(err)
					ftpSync.log("remove",path,"error",err);
				else {
					self.$changedFiles[path]&&delete self.$changedFiles[path];
					ftpSync.log("remove",path,"success");
				}

		});
		break;
	}
}

FtpWork.prototype.download=function(path){
	
}

FtpWork.prototype._download=function(){

}



var ftpSync=new FtpSync();
ftpSync.log=ftpSync.error=function(){
	console.log.call(console,arguments);
}

module.exports=ftpSync;