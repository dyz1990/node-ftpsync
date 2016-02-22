# node-ftpsync
synchronize files to the server via FTP
通过FTP同步文件到服务器

  在使用Zend studio修改项目时，Zs自带的文件上传功能老是卡死，<br>
  于是自己用nodejs写了个自己上传项目中修改的文件到服务器

  原理是使用[chokidar](https://github.com/paulmillr/chokidar)监听文件的更改，<br>
  包括添加和删除文件/文件夹<br>
  然后使用[ftp](https://github.com/mscdex/node-ftp)将文件上传到服务器

##配置
edit config.json
```json
{
	"host":"myhost.com",//ftp host
	"user":"ftpusername",//ftp  用户名
	"password":"",//ftp  密码
	"keepalive":60,//ftp 空闲时保持连接的时间
	"pasvTimeout":30,//ftp传输超时
	//"connTimeout":10,//ftp连接超时

	"excludes":["*.svn*"],//排除同步的路径，使用anymatch规则
	"includes":[],//即使被排除了也要同步的路径

	"activeAll":false,//启动时是否连接所有的works工作
	//工作定义
	"works":[
		{
		  //"host":"",
		  //"user":"",默认使用外面的ftp连接
			"name":"ftpsync",
			"clientPath":".",//本地工作目录
			"serverPath":"/node/ftpsync",//服务器端目录
			"autoUpload":true,//文件自动同步到服务器
			"ignoreInitial":true,//如果为false，启动时会把所有文件添加到上传列表，如果autoUpload也为true，则第一次启动时会上传工作目录的所有文件
			"excludes":[/\.works/],
			"includes":[]
		},
		{
			"name":"proj1",
			"enabled":true,//是否启用这个同步工作，默认:true
			"clientPath":"E:/wamp/htdocs/proj1",
			"serverPath":"/web/proj1",
			"autoUpload":true,
			"ignoreInitial":true,
			"excludes":[/.*\.svn.*/,/.*[\/\\]runtime.*/,/resource[\/\\]uploads.*/]

		}
	]	
}
```

##使用
在ftpsync目录中打开控制台，<br>
```cmd
node index.js
```
如果配置中所有工作work配置的autoUpload=true，那就不用管了。
输入 workName.changes() 查看所有修改且还没上传的文件
输入 workName.upload() 同步上面列出来的文件到服务器
输入 workName.close() 关闭工作的ftp
输入 closeAll() 关闭所有工作

##Required
[chokidar](https://github.com/paulmillr/chokidar)监听文件的更改
[ftp](https://github.com/mscdex/node-ftp) FTP客户端
[anymatch](https://github.com/es128/anymatch) 路径配置

