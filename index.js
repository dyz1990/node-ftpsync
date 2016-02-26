var readline=require('readline');

var rl=readline.createInterface({
	input:process.stdin,
	output:process.stdout,
	completer:function(line){
		var completions = words;

        var hits = completions.filter(function(c) { return c.indexOf(line) == 0 })
        return [hits.length ? hits : completions, line]
	},
	terminal: true
});


rl.setPrompt('>');
rl.prompt(true);
rl.on("line",function(line){
	line=line.trim();
	if(line){
		try{		
			with(ftpSync){
				result=eval(line);
			}

			if(typeof result==='object')	
				console.log(result?result.toString():result);
			else if(result!==undefined)
				console.log(result);
			
		}catch(e){
			console.trace(line,e);
		}
	}
	rl.prompt(true);
});

rl.on('SIGINT', function() {
    rl.question('Sure to exit ? ', function(answer) {
        if (answer.match(/^y(es)?$/i)) {
        	ftpSync.closeAll();
            process.exit(0);
        }else {
            rl.prompt(true);
        }
    });
});

rl.on('close', function() {
    process.exit(0);
});
//////////////////////////
var fs = require('fs');
var ftpSync= require("./ftpsync.js");

var config=fs.readFileSync("./config.json",'utf-8');
if(config)
	ftpSync.config(eval("("+config+")"));
var words=ftpSync.worksName();
words.push('upload');
words.push('changes');
words.push('closeAll');
words.push('close');
words.push('listServer');
words.push('listLocal');
ftpSync.log=ftpSync.error=function(){
	var data=Array.prototype.slice.call(arguments,0).join(" ");
	console.log(data);
	
	rl.prompt(true);
}