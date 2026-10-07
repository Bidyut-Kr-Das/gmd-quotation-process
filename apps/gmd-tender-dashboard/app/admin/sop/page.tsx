"use client";
import React, { useEffect, useState, useCallback } from "react";
import { Plus, Search, Trash2, Pencil, Save, X, Rows3 } from "lucide-react";
import { toast } from "sonner";
import SopResponsibilityDialog from "@/components/admin/SopResponsibilityDialog";

interface SopRow {
  id: number;
  columnName: string;
  description: string | null;
  allocatedTo: string | null;
  email: string | null;
  dailyLog: string | null;
  date: string | null;
  source: string | null;
  doneFromWhere: string | null;
  isManual: boolean;
  dailyLogEnabled: boolean;
  dateEnabled: boolean;
  createdAt: string;
}

interface DraftRow {
  tempId: number;
  columnName: string;
  description: string;
  allocatedTo: string;
  email: string;
  dailyLog: string;
  date: string;
  source: string;
  doneFromWhere: string;
  isManual: boolean;
  dailyLogEnabled: boolean;
  dateEnabled: boolean;
  fieldErrors?: Record<string, string>;
}

const SOURCE_OPTS = ["MANUAL","UPLOAD_EXCEL","SCRAPE_247","AI","DOCUMENT_PARSE","RA_AUTOMATION","GOOGLE_SHEET_SYNC","SYSTEM"];

function formatDateDisplay(iso: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit" }).format(d);
  } catch { return "-"; }
}

export default function SopAdminPage() {
  const [rows, setRows] = useState<SopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<SopRow | null>(null);

  const emptyDraft = (id:number):DraftRow=>({ tempId:id, columnName:"", description:"", allocatedTo:"", email:"", dailyLog:"", date:"", source:"", doneFromWhere:"", isManual:false, dailyLogEnabled:true, dateEnabled:true });
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() => [emptyDraft(1), emptyDraft(2), emptyDraft(3)]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [nextTempId, setNextTempId] = useState(4);

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/sop-responsibilities");
      const data = await res.json();
      if (data.success) setRows(data.data);
      else toast.error(data.error || "Failed to load");
    } catch { toast.error("Failed to load SOP responsibilities"); } finally { setLoading(false); }
  }, []);
  useEffect(()=>{ fetchRows(); },[fetchRows]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.columnName.toLowerCase().includes(q) || (r.allocatedTo||"").toLowerCase().includes(q) || (r.email||"").toLowerCase().includes(q) || (r.description||"").toLowerCase().includes(q) || (r.source||"").toLowerCase().includes(q) || (r.doneFromWhere||"").toLowerCase().includes(q);
  });

  async function handleDelete(id:number){ if(!confirm("Delete this SOP entry?")) return; try{ const res=await fetch(`/api/sop-responsibilities/${id}`,{method:"DELETE"}); const data=await res.json(); if(!res.ok) throw new Error(data.error||"Failed"); toast.success("Deleted"); fetchRows(); } catch(e:any){ toast.error(e.message||"Failed"); } }
  function openAddDialog(){ setEditData(null); setDialogOpen(true); }
  function openEditDialog(r:SopRow){ setEditData(r); setDialogOpen(true); }

  async function onDialogSave(data:any){
    let res:Response;
    if(editData) res=await fetch(`/api/sop-responsibilities/${editData.id}`,{method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)});
    else res=await fetch(`/api/sop-responsibilities`,{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)});
    const out=await res.json(); if(!res.ok) throw new Error(out.error||"Failed"); toast.success(editData?"Updated":"Created"); fetchRows();
  }

  function updateDraft(tempId:number, field:keyof DraftRow, value:any){ setDraftRows(prev=>prev.map(r=> r.tempId===tempId ? {...r, [field]:value, fieldErrors:undefined} : r)); }
  function addDraftRow(){ setDraftRows(prev=>[...prev, emptyDraft(nextTempId)]); setNextTempId(n=>n+1); }
  function removeDraftRow(tempId:number){ setDraftRows(prev=> prev.length<=1? prev : prev.filter(r=>r.tempId!==tempId)); }
  function clearDrafts(){ const a=emptyDraft(nextTempId), b=emptyDraft(nextTempId+1), c=emptyDraft(nextTempId+2); setDraftRows([a,b,c]); setNextTempId(n=>n+3); }

  function validateDraft(rows:DraftRow[]){
    const errors:Record<number,Record<string,string>>={}; let hasAnyValid=false;
    rows.forEach(r=>{
      const hasAny = r.columnName.trim()||r.description.trim()||r.allocatedTo.trim()||r.email.trim()||r.dailyLog.trim()||r.date.trim()||r.source.trim()||r.doneFromWhere.trim();
      if(!hasAny) return;
      if(!r.columnName.trim()){ if(!errors[r.tempId]) errors[r.tempId]={}; errors[r.tempId].columnName="Required"; } else hasAnyValid=true;
      if(r.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())){ if(!errors[r.tempId]) errors[r.tempId]={}; errors[r.tempId].email="Invalid email"; }
      if(r.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())){ if(!errors[r.tempId]) errors[r.tempId]={}; errors[r.tempId].date="Invalid date"; }
      if(r.source.trim() && !SOURCE_OPTS.includes(r.source.trim().toUpperCase())){ if(!errors[r.tempId]) errors[r.tempId]={}; errors[r.tempId].source="Invalid source"; }
    });
    return {valid: Object.keys(errors).length===0 && hasAnyValid, errors};
  }

  async function handleBulkSave(){
    const nonEmpty = draftRows.filter(r=> r.columnName.trim()||r.description.trim()||r.allocatedTo.trim()||r.email.trim()||r.dailyLog.trim()||r.date.trim()||r.source.trim()||r.doneFromWhere.trim());
    if(nonEmpty.length===0){ toast.error("Add at least one row with Column Name"); return; }
    const {valid, errors}=validateDraft(draftRows);
    if(!valid && Object.keys(errors).length>0){ setDraftRows(prev=>prev.map(r=>({...r, fieldErrors: errors[r.tempId]}))); const firstErr=Object.values(errors)[0]; toast.error(firstErr? Object.values(firstErr)[0]:"Fix validation"); return; }
    setBulkSaving(true);
    try{
      const payload = nonEmpty.map(r=>({
        columnName:r.columnName.trim(), description:r.description.trim()||null, allocatedTo:r.allocatedTo.trim()||null, email:r.email.trim()||null, dailyLog:r.dailyLog.trim()||null, date:r.date.trim()||null,
        source:r.source.trim()||null, doneFromWhere:r.doneFromWhere.trim()||null, isManual:r.isManual, dailyLogEnabled:r.dailyLogEnabled, dateEnabled:r.dateEnabled
      }));
      const res=await fetch("/api/sop-responsibilities/bulk",{method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({rows:payload})});
      const data=await res.json(); if(!res.ok) throw new Error(data.error||"Bulk failed");
      const created=data.created??0; const errs: {index:number, field:string, message:string}[] = data.errors||[];
      if(errs.length>0){
        const mapped:Record<number,Record<string,string>>={};
        errs.forEach(e=>{ const tempId=nonEmpty[e.index]?.tempId; if(tempId){ if(!mapped[tempId]) mapped[tempId]={}; mapped[tempId][e.field]=e.message; } });
        setDraftRows(prev=>prev.map(r=>({...r, fieldErrors: mapped[r.tempId]})));
        toast.error(`${created} created, ${errs.length} rows failed`);
      } else { toast.success(`${created} SOP rows created`); clearDrafts(); }
      fetchRows();
    } catch(e:any){ toast.error(e.message||"Bulk failed"); } finally{ setBulkSaving(false); }
  }

  if(loading) return <div style={{padding:"24px"}}><h1 style={{color:"var(--color-brand)", marginBottom:"24px"}}>SOP Responsibilities</h1><p style={{color:"#999"}}>Loading...</p></div>;

  return (
    <div className="w-full" style={{padding:"24px", margin:"0 auto", maxWidth:"1600px"}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px"}}>
        <h1 style={{color:"var(--color-brand)", margin:0, fontSize:"22px"}} className="font-bold">SOP Responsibilities</h1>
        <button onClick={openAddDialog} style={{padding:"8px 16px", background:"var(--color-brand)", color:"#fff", border:"none", borderRadius:"6px", cursor:"pointer", fontSize:"14px", fontWeight:600, display:"inline-flex", alignItems:"center", gap:"6px"}}><Plus size={14}/> Add Single</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2"><Rows3 size={16} className="text-brand"/><h2 className="text-sm font-semibold text-gray-900">Bulk Manual Entry</h2><span className="text-xs text-gray-500">Type multiple rows, then Save All — include Source/Done From Where</span></div>
          <div className="flex gap-2"><button onClick={addDraftRow} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 inline-flex items-center gap-1"><Plus size={12}/> Add Row</button><button onClick={clearDrafts} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md hover:bg-gray-50 inline-flex items-center gap-1"><X size={12}/> Clear</button><button onClick={handleBulkSave} disabled={bulkSaving} className="px-4 py-1.5 text-xs bg-brand text-white rounded-md hover:bg-brand-accent disabled:opacity-50 inline-flex items-center gap-1.5">{bulkSaving? <span>Saving...</span>:<><Save size={12}/> Save All ({draftRows.filter(r=>r.columnName.trim()).length})</>}</button></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead><tr className="bg-gray-50 text-gray-600">
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[150px]">Column Name *</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[180px]">Description</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[130px]">Allocated To</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[160px]">Email</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[120px]">Source</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[160px]">Done From Where</th>
              <th className="border border-gray-200 px-2 py-1.5 text-center min-w-[60px]">Manual?</th>
              <th className="border border-gray-200 px-2 py-1.5 text-center min-w-[60px]">DailyLog</th>
              <th className="border border-gray-200 px-2 py-1.5 text-center min-w-[60px]">Date</th>
              <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold min-w-[130px]">Date val</th>
              <th className="border border-gray-200 px-2 py-1.5 text-center w-[40px]"></th>
            </tr></thead>
            <tbody>
              {draftRows.map(r=>(
                <tr key={r.tempId} className="hover:bg-gray-50">
                  <td className="border border-gray-200 px-1 py-1"><input value={r.columnName} onChange={e=>updateDraft(r.tempId,"columnName",e.target.value)} placeholder="Column Name" className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 ${r.fieldErrors?.columnName?"border-red-400 focus:ring-red-400 bg-red-50":"border-gray-200 focus:ring-brand-accent"}`} />{r.fieldErrors?.columnName && <div className="text-[10px] text-red-500 px-1">{r.fieldErrors.columnName}</div>}</td>
                  <td className="border border-gray-200 px-1 py-1"><input value={r.description} onChange={e=>updateDraft(r.tempId,"description",e.target.value)} placeholder="Description" className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-accent" /></td>
                  <td className="border border-gray-200 px-1 py-1"><input value={r.allocatedTo} onChange={e=>updateDraft(r.tempId,"allocatedTo",e.target.value)} placeholder="Allocated To" className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-accent" /></td>
                  <td className="border border-gray-200 px-1 py-1"><input value={r.email} onChange={e=>updateDraft(r.tempId,"email",e.target.value)} placeholder="email" className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 ${r.fieldErrors?.email?"border-red-400 bg-red-50":"border-gray-200 focus:ring-brand-accent"}`} />{r.fieldErrors?.email && <div className="text-[10px] text-red-500">{r.fieldErrors.email}</div>}</td>
                  <td className="border border-gray-200 px-1 py-1"><select value={r.source} onChange={e=>{const v=e.target.value; const isAuto=["AI","DOCUMENT_PARSE","RA_AUTOMATION","SCRAPE_247"].includes(v); setDraftRows(prev=>prev.map(x=> x.tempId===r.tempId ? {...x, source:v, dailyLogEnabled: isAuto ? false : x.dailyLogEnabled, dateEnabled: isAuto ? false : x.dateEnabled, isManual: v==="MANUAL"}:x));}} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded"><option value="">-</option>{SOURCE_OPTS.map(o=><option key={o} value={o}>{o}</option>)}</select>{r.fieldErrors?.source && <div className="text-[10px] text-red-500">{r.fieldErrors.source}</div>}</td>
                  <td className="border border-gray-200 px-1 py-1"><input value={r.doneFromWhere} onChange={e=>updateDraft(r.tempId,"doneFromWhere",e.target.value)} placeholder="Done from where" className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded" /></td>
                  <td className="border border-gray-200 px-1 py-1 text-center"><input type="checkbox" checked={r.isManual} onChange={e=>updateDraft(r.tempId,"isManual",e.target.checked as any)} /></td>
                  <td className="border border-gray-200 px-1 py-1 text-center"><input type="checkbox" checked={r.dailyLogEnabled} onChange={e=>updateDraft(r.tempId,"dailyLogEnabled",e.target.checked as any)} /></td>
                  <td className="border border-gray-200 px-1 py-1 text-center"><input type="checkbox" checked={r.dateEnabled} onChange={e=>updateDraft(r.tempId,"dateEnabled",e.target.checked as any)} /></td>
                  <td className="border border-gray-200 px-1 py-1"><input type="date" value={r.date} onChange={e=>updateDraft(r.tempId,"date",e.target.value)} className="w-full px-1 py-1.5 text-xs border border-gray-200 rounded" /></td>
                  <td className="border border-gray-200 px-1 py-1 text-center"><button onClick={()=>removeDraftRow(r.tempId)} className="text-gray-400 hover:text-red-600 p-1"><X size={12}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">Column Name required. Source MANUAL keeps dailyLog/date true; AI/DOCUMENT_PARSE/RA/SCRAPE auto-sets them false (editable). Empty rows ignored.</p>
      </div>

      <div style={{position:"relative", marginBottom:"16px"}}>
        <Search size={14} style={{position:"absolute", left:"12px", top:"50%", transform:"translateY(-50%)", color:"#999"}}/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search column, allocated, email, source, doneFromWhere..." style={{width:"100%", padding:"8px 12px 8px 36px", border:"1px solid #e0e0e0", borderRadius:"8px", fontSize:"14px", color:"#333", outline:"none", boxSizing:"border-box"}}/>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-600 text-xs">
              <th className="text-left px-3 py-2 font-semibold">Column Name</th>
              <th className="text-left px-3 py-2 font-semibold">Description</th>
              <th className="text-left px-3 py-2 font-semibold">Done From Where</th>
              <th className="text-left px-3 py-2 font-semibold">Source</th>
              <th className="text-center px-3 py-2 font-semibold">Manual?</th>
              <th className="text-left px-3 py-2 font-semibold">Allocated To</th>
              <th className="text-left px-3 py-2 font-semibold">DailyLog/Date</th>
              <th className="text-right px-3 py-2 font-semibold">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length===0? <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">No SOP responsibilities found.</td></tr> : filtered.map(r=>(
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-brand">{r.columnName}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[220px] truncate" title={r.description||""}>{r.description||"-"}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate" title={r.doneFromWhere||""}>{r.doneFromWhere||"-"}</td>
                  <td className="px-3 py-2 text-xs"><span className={`px-2 py-0.5 rounded text-xs ${r.source==="MANUAL"?"bg-brand-light text-brand": r.source==="AI"?"bg-purple-50 text-purple-700":"bg-gray-100 text-gray-700"}`}>{r.source||"-"}</span></td>
                  <td className="px-3 py-2 text-center">{r.isManual? "✓":"-"}</td>
                  <td className="px-3 py-2 text-gray-700">{r.allocatedTo||"-"}<div className="text-xs text-gray-500">{r.email||""}</div></td>
                  <td className="px-3 py-2 text-xs">{r.dailyLogEnabled?"Log ":""} {r.dateEnabled?"Date":""} {!r.dailyLogEnabled && !r.dateEnabled && <span className="text-gray-400">false/false (AI/parse)</span>} <div className="text-gray-400">{formatDateDisplay(r.date)}</div></td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-1"><button onClick={()=>openEditDialog(r)} className="p-1.5 text-gray-500 hover:text-brand hover:bg-gray-100 rounded"><Pencil size={14}/></button><button onClick={()=>handleDelete(r.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14}/></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100">{filtered.length} of {rows.length} entries</div>
      </div>

      <SopResponsibilityDialog open={dialogOpen} onClose={()=>setDialogOpen(false)} onSave={onDialogSave} initialData={editData? {id:editData.id, columnName:editData.columnName, description:editData.description, allocatedTo:editData.allocatedTo, email:editData.email, dailyLog:editData.dailyLog, date:editData.date?String(editData.date).slice(0,10):null, source:editData.source, doneFromWhere:editData.doneFromWhere, isManual:editData.isManual, dailyLogEnabled:editData.dailyLogEnabled, dateEnabled:editData.dateEnabled} : null} />
    </div>
  );
}
