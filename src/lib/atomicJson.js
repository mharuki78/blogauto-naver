const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function writeJsonAtomic(file,value) {
  const data=JSON.stringify(value,null,2)+'\n';
  const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+crypto.randomUUID()+'.tmp');
  try {
    const fd=fs.openSync(temp,'wx',0o600);
    try{fs.writeFileSync(fd,data,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,file);
  } finally {
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
module.exports={writeJsonAtomic};
