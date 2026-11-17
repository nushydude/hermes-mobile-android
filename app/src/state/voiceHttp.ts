export async function limitedText(response:Response,limit:number) {
  const size=Number(response.headers.get('content-length')); if(Number.isFinite(size)&&size>limit) throw new Error('Response too large');
  const stream=response.body as ReadableStream<Uint8Array> | null;
  if(stream && typeof stream.getReader==='function') {const reader=stream.getReader();const decoder=new TextDecoder();let total=0,text='';try {while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>limit){await reader.cancel();throw new Error('Response too large');}text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}}
  const text=await response.text();if(text.length>limit)throw new Error('Response too large');return text;
}
