import { prisma } from "../lib/prisma";
async function main(){
  const c = await prisma.bisStatus.count();
  console.log('count', c);
}
main().catch(e=>{ console.log(e.code, e.message.slice(0,1200)); console.log(e)}).finally(()=> prisma.$disconnect());
