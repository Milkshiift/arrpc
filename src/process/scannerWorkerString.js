export const workerCode = `var{defineProperty:R,getOwnPropertyNames:$,getOwnPropertyDescriptor:C}=Object,E=Object.prototype.hasOwnProperty;var S=new WeakMap,T=(q)=>{var z=S.get(q),A;if(z)return z;if(z=R({},"__esModule",{value:!0}),q&&typeof q==="object"||typeof q==="function")$(q).map((y)=>!E.call(z,y)&&R(z,y,{get:()=>q[y],enumerable:!(A=C(q,y))||A.enumerable}));return S.set(q,z),z};var U=(q,z)=>{for(var A in z)R(q,A,{get:z[A],enumerable:!0,configurable:!0,set:(y)=>z[A]=()=>y})};var G={};U(G,{getProcessesWindows:()=>Y,getProcessesLinux:()=>X});module.exports=T(G);var Q=require("worker_threads"),N=require("fs/promises"),V=require("child_process"),X=async()=>{try{let z=(await N.readdir("/proc",{withFileTypes:!0})).filter((y)=>y.isDirectory()&&/^\\d+$/.test(y.name)).map(async(y)=>{let H=+y.name;try{let J=await Promise.race([N.readFile(\`/proc/\${H}/cmdline\`,"utf8"),new Promise((I,O)=>setTimeout(()=>O(new Error("Timeout")),100))]);try{if((await N.readFile(\`/proc/\${H}/status\`,"utf8")).includes("State:\\tT"))return null}catch(I){}let K;try{K=await N.readlink(\`/proc/\${H}/cwd\`)}catch(I){}let M=J.split("\\x00").filter((I)=>I.trim()!=="");return M.length?[H,M[0],M.slice(1),K]:null}catch{return null}});return(await Promise.all(z)).filter(Boolean)}catch(q){return console.error("Process discovery error:",q),[]}},Y=()=>new Promise((q)=>V.exec("wmic process get ProcessID,ExecutablePath /format:csv",(z,A)=>{q(A.toString().split(\`\\r
\`).slice(2).map((y)=>{let H=y.trim().split(",").slice(1).reverse();return[parseInt(H[0])||H[0],H[1]]}).filter((y)=>y[1]))})),W=process.platform==="linux"?X:Y,Z;function j(q){let A=q.toLowerCase().replaceAll("\\\\","/").split("/");if(/^[a-z]:$/.test(A[0])||A[0]==="")A.shift();let y=[],H=["64",".x64","x64","_64"],J=A.length+1;y.length=J*(H.length+1);let K=0;for(let M=0;M<A.length||M===1;M++){let I=A.slice(-M).join("/");y[K++]=I;for(let O of H)if(I.includes(O))y[K++]=I.replace(O,"")}return y.filter(Boolean)}function B(q,z,A,y){if(!q)return!1;if(!(!q.a||A&&A.includes(q.a)))return!1;return q.n.some((J)=>{if(J[0]===">")return J.substring(1)===z[0];return z.some((K)=>J===K||y&&\`\${y}/\${K}\`.includes(\`/\${J}\`))})}async function F(){try{let q=await W(),z=new Set;for(let[A,y,H,J=""]of q){let K=j(y);for(let{e:M,i:I,n:O}of Z)if(B(M,K,H,J))z.add({id:I,name:O,pid:A})}Q.parentPort.postMessage({type:"scan_results",games:Array.from(z)})}catch(q){Q.parentPort.postMessage({type:"error",error:q.message})}}Q.parentPort.on("message",async(q)=>{switch(q.type){case"init":Z=q.detectable,Q.parentPort.postMessage({type:"initialized"});break;case"scan":await F();break}});
`;