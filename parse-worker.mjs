import {parseEvidence} from './core.mjs';
self.onmessage=async({data})=>{
  try {self.postMessage({id:data.id,result:await parseEvidence(data.bytes,data.filename)});}
  catch(error) {self.postMessage({id:data.id,error:error.message});}
};
