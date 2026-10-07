import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { syncMasterWebsites } from "../lib/google-sheets";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  // await prisma.exlusionKeywords.deleteMany();
  // await prisma.exlusionKeywords.deleteMany();
  await prisma.exlusionKeywords.createMany({
    data: [
      {
        category: "cable",
        keywords:
          "cctv,camera,replacement,erection,opgw,shifting,modification,repair,laying,installation,release,junction,weld testing,optical,battery,kit,elastomeric,coupler,pijf,lightning arrestor,greasing pump,cable trench,transmitter,welding,metering,design,cctv,rcc,cat 6,maintenance,defect,accessories,portland cement,spares,packing,instrumentation,assembly,harness,clamp,hardwares,fire alarm,devices,cat b,accelerometer,submersible,ms wire,telecom CABLE,cat-c,transformer,breakdown,augmentation,alloy steel pipes,cable locator,telephone,constructing,catenary,conversion,erecting,,associated works,re-organisation,cable clip,monitoring system,microwave,dismantling,tying wires,sealing wire,kw,labour,nylon components,spring steel wire,plasticware,CABLE BOX,OPTIC,FIBRE,SCREW CAP,GENERATOR,CABLE TIES,DAC CABLE,COMPUTER CABLES,CAT-6,ROTARY END,STAY WIRE,PENS,POLE,COUPLING CABLE,CABLE PROTECTORS,RUBBER,KEYBOARD,ADSS,BRASS WIRE,FIBRE GLASS,CO-AXIAL,COAXIAL,CO AXIAL,SENSOR,TR CABLE,TR. CABLE,TR-CABLE,GI WIRE,G.I. WIRE,GALVANISED STEEL WIRE,REERER POWER PACKS,BARBED WIRE,ENAMELLED COPPER,FEED CABLE,VACCUM GAUGE,HARD DRAWN BARE COPPER WIRE,TRIAXIAL CABLE,TRI-AXIAL CABLE,HULL ELECTRIC WIRES,MAGNET CABLE,TWIN-AX CABLE,TWINAX CABLE,TWINAX,TWIN-AX,SUPER CONDUCTING WIRE,KAT WIRE,PTFE CABLE,SILVER WIRE,TURRET ELECTRIC WIRE,WIRE ASSY,WIRE ASSEMBLY,FAULT FINDING,GI PIPE,HDMI,rehabilitation,COMMUNICATION,JOINTS,GLANDS,GLAND,usb,kx-21,CABLE ASSY,SPIRAL CABLE,SPEAKER CABLE,MULTI SHOT FIRING CABLE,SERIAL CABLE,FIBER CABLE,GMAW WIRE,CHARGER CABLE,FEEDER CABLE,HEAT TRACE CABLE,cable insulation treatment.,PORTAND CEMENT,LIGHTING CABLE,ENERGY METER,SURGICAL,SUPER-TREX,CABLE WRAPPING TAPE,LIGHTING,JACK MODULES,INDICATOR,AEROBIAX,TRIAD,ZM CONNECTION,CONCRETE CABLE,CONDUIT,BRAIDED CABLE,WEDGE WIRE,M.S. WIRE,FERRULE,LOCK WIRES,FEMALE CONNECTOR,hand brake,ENAMELLED,CONTROLLER,video,air conditioning,structure,spark rod,switch,adapter,automotive,antenna,layout,fence material,camera,socket,ethernet,laparascopic,catheters,stringing,fencing,guidewall cables,onboard wire,median cable,cap lamp,scissors,winding motors,scientific,converter card,vitebsk,cable puller,ethyl,carrying cables,steering cables,security wires,leftover work,sleeve,stitching wire,db box,brushes wire,end sleeves,CABLE TIE,cable tie,neoprene,cable trails,router,monitoring cable,converters,consumable spare parts,polyester cabinet,f-16 cable,washing machine,flex ball,MAGNET wire,magnetic,tail cable.,tail cable,capacitor bank,drill cables,drill cable,earthwire,opg wire,spacer,flexible,coax,cutting,flux,fixing,radio,frequency,iron,retention,terminal,150 kv,ropes,steel cables,steel,wdg wire,fuse wires,fuse wire,fuse,utp cables,utp cable,electrode,tanmar cables,enamel copper,enamel,shielded,cu mica,thermocouple,thermcouple cable,paper covered,saw wire,lapped,polyimide covered copper wire,wound,travelling cable,detector cable,connection cable,slinging,annealed,e beam,e-beam,cable tie,polyolefin,CLEAT,STAPLES,STATIONERY,street light,submarine,rdso/pe/spec/tl/0027-2002,SHORT FIRING,PAIR Cable,triad,cutout,palletised,pallet,irss 76/89,cable products,epr,rubberised,SPIRAL,fixing,BLOWOUT BOX,SURVEY,ERECTION,ELECTRON BEAM,UNF CABLE,EBEAM,DRAWING,TR. LINE,IS-13573,CONDUCTOR BRACKET,IS 13573,TRAILING,CONNECTIVITY,equalizer pin,microlek-onlinE,WINCH CABLE,JOINTING WORK,WIRE ROPE SLING,Wire Crate Spur,Voltage Detector,flex-ball cable short,DROPPER WIRE,DRAG CHAIN,PLUG,CABLE THROUGH BOX,SOLDERING,WIRE ROPE,annual maint.,Construction of road,manning operation,CONFERENCE SOUND SYSTEM,Surveillance,HAGER,cover cable cubby,restoration,Construction of Concrete,bulb,wire saw,AFTC CABLE,CABLE LUGS,CAT CABLES,CABLE LUG,PULL WIRE,DISTRIBUTION VEHICLE,STRENGTHENING,ELESTOMERIC,WIRELESS,HEAD WATER WORKS,ALTERATION TO LT PANEL,RCU CABLE,ANALYZER,NETWORK MATERIAL,ANALYSER,EBXL,RING MAIN UNIT,TROLLEYS,TROLLEY,INDIGENOUS DEVELOPMENT,LARGE SPAN WIRE,ROUTING,ROUTE TRACER,PAINTING,NICKEL,NICKLE,METALLIC HOSE,TRIAXIAL,SITAR STRINGS,CABLE TRAY,WIRE BOOK STITCHING,FIRE WIRE,MCB,DG SET,TURNKEY,PUMP,TYING/REPLACE,WATER SUPPLY DUCT,high level interfac,TORQUE TESTER,SILVER PLATED COPPER WIRE,LAPROSCOPIC,CT COIL,WASHING POWDER,STARTER PANEL,CRIMPING TOOL,CRIMPING TOOLS,WINDING WIRE,TRANSPORTATION,STRAIN GAUGE,15HP,CABLIZATION,TUBULAR TIN,EARTHING CABLE COMPLETE,SLING WIRE,m.s binding wire,GNYE 1.8KV,zinc coated ed m wire,CABLE HEAD TERMINATION,HARD DRAWN,PLIABLE ARMOURED CABLE,R&M",
      },
      {
        category: "conductors",
        keywords:
          "cctv,camera,htls,fittings,labour,flexible,fuse,erection,copper,diesel,telephone,connector,civil,removal,destringing,repairing,fabrication,stationery,design,structure,lightning conductor,installation,tightening,dismantling,replacement,laying,stringing,bimetallic,clamp,rewinding,maintenance,lighting conductor,cabling,stinging,a class electrical,feeder-i,shifting,apparatus,strengthening,augmantation,repair,earthing,plastic,augumentation,water storage,rectifier,superconducting,winding,CONSTRUCTION,THEFT,CUSHION,TRANSVERSE,ADSS,BRASS WIRE,FIBRE GLASS,CO-AXIAL,COAXIAL,CO AXIAL,SENSOR,TR CABLE,TR. CABLE,TR-CABLE,GI WIRE,G.I. WIRE,GALVANISED STEEL WIRE,REERER POWER PACKS,BARBED WIRE,ENAMELLED COPPER,FEED CABLE,VACCUM GAUGE,HARD DRAWN BARE COPPER WIRE,TRIAXIAL CABLE,TRI-AXIAL CABLE,HULL ELECTRIC WIRES,MAGNET CABLE,TWIN-AX CABLE,TWINAX CABLE,TWINAX,TWIN-AX,SUPER CONDUCTING WIRE,KAT WIRE,PTFE CABLE,SILVER WIRE,TURRET ELECTRIC WIRE,WIRE ASSY,WIRE ASSEMBLY,FAULT FINDING,GI PIPE,STUB SETTING,erecting,tension hardware,re conductoring,weighbridge,evacuation,execution,augmentation,medical supplies,replenishment,pump,testing,testting,lightening,hiring,pneumatic,appointment,resagging,removed,fixing,TR.LINE,TR. LINE,CONDUCTOR BRACKET,TWIN CONDUCTOR,DRAG CHAIN,re-sagging,WORK CONTRACT,TURNKEY,TUBULAR TIN,EARTHING CABLE COMPLETE,R&M",
      },
    ],
    skipDuplicates: true,
  });

  
  const Associates = [
      {
        name: "Sandip Das",
        email: "sandip.das@gmdalui.co.in",
      },
      {
        name: "Salil Kumar Datta",
        email: "lasertender.six@gmail.com",
      },
      {
        name: "Dolly Kayal",
        email: "execution@gmdalui.co.in",
      },
      {
        name: "Ram Mohan Roy",
        email: "lasertender.one@gmail.com",
      },
      {
        name: "Pritha",
        email: "sales@gmdalui.co.in",
      },
      {
        name: "Test User(AI TEAM)",
        email: "bidyutdas.gmdalui@gmail.com",
      },
      {
        name: "Amarnath Manna",
        email: "amanna@gmdalui.co.in",
      },
      {
        name: "Ashik Mandal",
        email: "lasertender.four@gmail.com",
      },
      {
        name: "Pritikana Maity",
        email:"laserentry.eight@gmail.com"
      },
      {
        name: "Ritwick Dutta",
        email:"laserentery.two@gmail.com"
      }
    ]

    
  Associates.map(async (a)=>{

    await prisma.association.upsert({
      where: {
        email: a.email
      },
      create:{
        email: a.email,
        name: a.name,
      },
      update:{
        email: a.email,
        name: a.name
      }
      // skipDuplicates: true,
    });
  })




  // const result = await syncMasterWebsites();
  // if (result.errors.length) {
  //   console.error("❌ Errors syncing tender status records:", result.errors);
  // }
  // console.log(
  //   `✅ Synced ${result.total} tender status records from Google Sheets.`,
  // );

  const adminPassword = await bcrypt.hash("admin123", 10);
  await prisma.user.upsert({
    where: { email: "admin@gmdalui.co.in" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@gmdalui.co.in",
      passwordHash: adminPassword,
      role: "admin",
    },
  });
  console.log("✅ Admin user seeded (admin@gmdalui.co.in / admin123).");

  console.log("✅ Seed completed.");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
