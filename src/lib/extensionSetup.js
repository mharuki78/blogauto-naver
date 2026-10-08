const fs=require('node:fs');
const path=require('node:path');
function prepareExtension(sourceDir,destinationDir) {
  const source=path.resolve(sourceDir),destination=path.resolve(destinationDir);
  if(!fs.existsSync(path.join(source,'manifest.json')))throw new Error('설치할 Chrome 확장을 찾지 못했습니다. 앱을 다시 받아 주세요.');
  fs.mkdirSync(destination,{recursive:true});
  for(const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if(entry.isFile() && /\.(js|css|html)$/.test(entry.name) || entry.isFile() && entry.name==='manifest.json')fs.copyFileSync(path.join(source,entry.name),path.join(destination,entry.name));
    if(entry.isDirectory() && entry.name==='icons') {
      fs.mkdirSync(path.join(destination,'icons'),{recursive:true});
      for(const name of fs.readdirSync(path.join(source,'icons')))if(/^icon-\d+\.png$/.test(name))fs.copyFileSync(path.join(source,'icons',name),path.join(destination,'icons',name));
    }
  }
  return destination;
}
module.exports={prepareExtension};
