"use client";
import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { ChevronUp, ChevronDown, Columns3, Search, X } from "lucide-react";
import "./TenderTable.css";

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
}

interface DailyLog { id:number; sopResponsibilityId:number; date:string; isChecked:boolean; checkedBy:string|null; checkedAt:string|null; }

interface ColumnDef {
  header: string;
  accessor: keyof SopRow | "dailyLogCheck";
  defaultWidth: number;
  type: "string" | "boolean" | "date" | "custom";
  sticky?: boolean;
}

const columns: ColumnDef[] = [
  { header: "Column Name", accessor: "columnName", defaultWidth: 200, type: "string", sticky: true },
  { header: "Description", accessor: "description", defaultWidth: 260, type: "string", sticky: true },
  { header: "Done From Where", accessor: "doneFromWhere", defaultWidth: 220, type: "string" },
  { header: "Source", accessor: "source", defaultWidth: 140, type: "string" },
  { header: "Manual?", accessor: "isManual", defaultWidth: 90, type: "boolean" },
  { header: "Allocated To", accessor: "allocatedTo", defaultWidth: 160, type: "string" },
  { header: "Email", accessor: "email", defaultWidth: 200, type: "string" },
  { header: "Daily Log", accessor: "dailyLogCheck", defaultWidth: 110, type: "custom" },
  { header: "DailyLog En", accessor: "dailyLogEnabled", defaultWidth: 100, type: "boolean" },
  { header: "Date En", accessor: "dateEnabled", defaultWidth: 90, type: "boolean" },
  { header: "Info", accessor: "date", defaultWidth: 160, type: "date" },
];

const BOOLEAN_COLS = new Set(["isManual","dailyLogEnabled","dateEnabled"]);
const SKIP_FILTER_COLS = new Set(["dailyLogCheck"]);

export function SopTable({ rows, dailyLogs, selectedDate, onToggle, isAuthenticated, togglingId }: {
  rows: SopRow[]; dailyLogs: Map<number, DailyLog>; selectedDate:string; onToggle:(id:number, cur:boolean)=>void; isAuthenticated:boolean; togglingId:number|null;
}) {
  const [columnWidths, setColumnWidths] = useState<Record<string,number>>(()=>{ const m:Record<string,number>={}; columns.forEach(c=>m[String(c.accessor)]=c.defaultWidth); return m; });
  const resizingRef = useRef<string|null>(null);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const handleResizeStart = (e:React.MouseEvent, accessor:string, curW:number)=>{
    e.preventDefault(); e.stopPropagation();
    resizingRef.current=accessor; startXRef.current=e.clientX; startWRef.current=curW;
    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor="col-resize";
  };
  const handleResizeMove = (e:MouseEvent)=>{
    if(!resizingRef.current) return;
    const newW = Math.max(50, startWRef.current + (e.clientX - startXRef.current));
    setColumnWidths(prev=>({...prev, [resizingRef.current!]: newW}));
  };
  const handleResizeEnd = ()=>{
    resizingRef.current=null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor="default";
  };

  const stickyOffsets = useMemo(()=>{
    const o:Record<string,number>={}; let acc=0;
    for(const c of columns){ if(c.sticky){ o[String(c.accessor)]=acc; acc+= columnWidths[String(c.accessor)] ?? c.defaultWidth; } }
    return o;
  },[columnWidths]);

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>("columnName");
  const [sortDirection, setSortDirection] = useState<"asc"|"desc">("asc");
  const handleSort = (acc:string)=>{ if(sortColumn===acc) setSortDirection(d=>d==="asc"?"desc":"asc"); else { setSortColumn(acc); setSortDirection("asc"); } };

  // Filters
  const [multiFilters, setMultiFilters] = useState<Record<string,string[]>>({});
  const [openDropdown, setOpenDropdown] = useState<string|null>(null);
  const [columnSearchText, setColumnSearchText] = useState<Record<string,string>>({});
  const dropdownRefs = useRef<Record<string,HTMLDivElement|null>>({});
  const [columnVisibility,setColumnVisibility]=useState<Record<string,boolean>>({});
  const [showPicker,setShowPicker]=useState(false);
  const [pickerSearch,setPickerSearch]=useState("");

  useEffect(()=>{
    const handler=(e:MouseEvent)=>{
      if(openDropdown && dropdownRefs.current[openDropdown] && !dropdownRefs.current[openDropdown]!.contains(e.target as Node)){
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown",handler);
    return ()=>document.removeEventListener("mousedown",handler);
  },[openDropdown]);

  const visibleColumns = useMemo(()=> columns.filter(c=> columnVisibility[String(c.accessor)]!==false),[columnVisibility]);

  const toggleFilter=(col:string, val:string)=>{
    setMultiFilters(prev=>{
      const cur=prev[col]||[]; const exists=cur.includes(val);
      const next= exists? cur.filter(v=>v!==val) : [...cur, val];
      if(next.length===0){ const { [col]:_, ...rest}=prev; return rest as any; }
      return {...prev, [col]: next};
    });
  };
  const selectAllFilter=(col:string, vals:string[])=> setMultiFilters(prev=>({...prev,[col]:[...vals]}));
  const clearFilter=(col:string)=> setMultiFilters(prev=>{ const {[col]:_,...rest}=prev as any; return rest; });

  const getFilteredExcept = useCallback((exclude:string, base: SopRow[])=>{
    return base.filter(r=>{
      // multiFilters except exclude
      for(const [col, vals] of Object.entries(multiFilters)){
        if(col===exclude) continue;
        const v = col==="dailyLogCheck" ? (dailyLogs.get(r.id)?.isChecked ? "Yes":"No") : String((r as any)[col] ?? (r as any)[col]===""?"": (r as any)[col]);
        const str = col==="isManual"||col==="dailyLogEnabled"||col==="dateEnabled" ? ((r as any)[col] ? "Yes":"No") : (v===null||v===undefined||v==="" ? "(Blank)" : String(v));
        if(!vals.includes(str)) return false;
      }
      for(const [col, txt] of Object.entries(columnSearchText)){
        if(col===exclude) continue;
        if(!txt) continue;
        const val = String((r as any)[col] ?? "");
        if(!val.toLowerCase().includes(txt.toLowerCase())) return false;
      }
      return true;
    });
  },[multiFilters, columnSearchText, dailyLogs]);

  const uniqueCache = useMemo(()=>{
    if(!openDropdown) return [] as string[];
    if(SKIP_FILTER_COLS.has(openDropdown)) return [];
    if(openDropdown==="dailyLogCheck"){
      return ["Yes","No","(Blank)"];
    }
    if(BOOLEAN_COLS.has(openDropdown)) return ["Yes","No","(Blank)"];
    const vals = new Set<string>();
    const base = rows;
    const filtered = getFilteredExcept(openDropdown, base);
    for(const r of filtered){
      const raw = (r as any)[openDropdown];
      const s = raw===null||raw===undefined||raw==="" ? "(Blank)" : String(raw);
      vals.add(s);
    }
    return Array.from(vals).sort();
  },[openDropdown, rows, getFilteredExcept]);

  const processed = useMemo(()=>{
    let out = rows.filter(r=>{
      for(const [col, vals] of Object.entries(multiFilters)){
        const v = col==="dailyLogCheck" ? (dailyLogs.get(r.id)?.isChecked ? "Yes":"No") : String((r as any)[col] ?? "");
        let str: string;
        if(col==="isManual"||col==="dailyLogEnabled"||col==="dateEnabled") str = (r as any)[col] ? "Yes":"No";
        else if(col==="dailyLogCheck") str = v;
        else str = (r as any)[col]===null|| (r as any)[col]===undefined || (r as any)[col]==="" ? "(Blank)" : String((r as any)[col]);
        if(!vals.includes(str)) return false;
      }
      for(const [col, txt] of Object.entries(columnSearchText)){
        if(!txt) continue;
        const val = String((r as any)[col] ?? "");
        if(!val.toLowerCase().includes(txt.toLowerCase())) return false;
      }
      return true;
    });
    if(sortColumn){
      out = [...out].sort((a,b)=>{
        let av:any, bv:any;
        if(sortColumn==="dailyLogCheck"){ av = dailyLogs.get(a.id)?.isChecked ? 1:0; bv = dailyLogs.get(b.id)?.isChecked?1:0; }
        else { av = (a as any)[sortColumn]; bv = (b as any)[sortColumn]; }
        if(av===null||av===undefined) av=""; if(bv===null||bv===undefined) bv="";
        if(typeof av==="boolean") av = av?1:0; if(typeof bv==="boolean") bv=bv?1:0;
        if(typeof av==="string" && typeof bv==="string") {
          const cmp = av.toLowerCase().localeCompare(bv.toLowerCase());
          return sortDirection==="asc"? cmp: -cmp;
        }
        if(av < bv) return sortDirection==="asc"? -1:1;
        if(av > bv) return sortDirection==="asc"? 1:-1;
        return 0;
      });
    }
    return out;
  },[rows, multiFilters, columnSearchText, sortColumn, sortDirection, dailyLogs]);

  return (
    <div className="tender-table-container" style={{display:"flex", flexDirection:"column", flex:1, minHeight:0, maxHeight:"calc(100vh - 220px)", overflow:"hidden"}}>
      <div className="tender-table-toolbar" style={{position:"sticky", top:0, zIndex:5}}>
        <div className="toolbar-left">
          <h2 className="table-title">SOP Responsibilities</h2>
          <span className="record-count-badge">{processed.length} / {rows.length}</span>
          <span className="text-xs text-white/80 hidden md:inline">IST: {selectedDate}</span>
        </div>
        <div className="toolbar-right">
          <button className="export-btn" onClick={()=>setShowPicker(v=>!v)}><Columns3 size={14}/> Columns</button>
        </div>
      </div>

      {showPicker && (
        <>
          <div style={{position:"fixed", inset:0, zIndex:40}} onClick={()=>setShowPicker(false)} />
          <div style={{position:"absolute", right:16, marginTop:4, width:280, background:"#fff", border:"1px solid #cbd5e1", borderRadius:6, boxShadow:"0 10px 15px rgba(0,0,0,0.1)", zIndex:50, padding:12}}>
            <div className="flex justify-between items-center mb-2"><span className="text-xs font-semibold">Columns {visibleColumns.length}/{columns.length}</span><button className="text-xs text-brand" onClick={()=>setShowPicker(false)}><X size={12}/></button></div>
            <input value={pickerSearch} onChange={e=>setPickerSearch(e.target.value)} placeholder="Search..." className="w-full px-2 py-1 text-xs border border-gray-200 rounded mb-2" />
            <div className="flex gap-2 mb-2"><button className="text-xs text-brand" onClick={()=>setColumnVisibility({})}>Select All</button><button className="text-xs text-brand" onClick={()=>{const m:Record<string,boolean>={}; columns.forEach(c=> m[String(c.accessor)]=false); // keep at least one
              const first=String(columns[0].accessor); delete m[first]; setColumnVisibility(m);}}>Clear</button></div>
            <div style={{maxHeight:300, overflowY:"auto", display:"flex", flexDirection:"column", gap:4}}>
              {columns.filter(c=> !pickerSearch || c.header.toLowerCase().includes(pickerSearch.toLowerCase())).map(c=>{
                const key=String(c.accessor); const checked= columnVisibility[key]!==false;
                return <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={checked} onChange={e=> setColumnVisibility(prev=>({...prev, [key]: e.target.checked ? undefined as any : false}))} />{c.header}</label>
              })}
            </div>
          </div>
        </>
      )}

      <div className="tender-table-wrapper" style={{position:"relative", flex:1, overflow:"auto", minHeight:0}}>
        <table className="tender-data-table">
          <thead style={{position:"sticky", top:0, zIndex:3}}>
            <tr>
              {visibleColumns.map(col=>{
                const key=String(col.accessor);
                const w = columnWidths[key] ?? col.defaultWidth;
                const isSorted = sortColumn===key;
                const showFilter = !SKIP_FILTER_COLS.has(key) || BOOLEAN_COLS.has(key) || key==="dailyLogCheck" || key==="source";
                const isStickyCol = !!col.sticky;
                // Header must be sticky top:0 and also sticky left for pinned cols; zIndex 4 for pinned header corner
                const zIdx = openDropdown===key? 100 : isStickyCol? 4 : 3;
                return (
                  <th key={key} className={col.sticky?"sticky-col":undefined} style={{width:w, minWidth:w, position:"sticky", top:0, ...(col.sticky?{left: stickyOffsets[key], zIndex: zIdx}: {zIndex: zIdx}), backgroundColor:"var(--color-bg-light)"}}>
                    <div className="header-content" onClick={()=>handleSort(key)}>
                      <span style={{overflow:"hidden", textOverflow:"ellipsis"}}>{col.header}</span>
                      <span className="sort-indicator">{isSorted ? (sortDirection==="asc"? <ChevronUp size={12}/> : <ChevronDown size={12}/>) : null}</span>
                    </div>
                    {showFilter && (
                      <div onClick={e=>e.stopPropagation()}>
                        {!SKIP_FILTER_COLS.has(key) && !BOOLEAN_COLS.has(key) && key!=="dailyLogCheck" ? (
                          // multi-select for string columns
                          <div className="custom-multiselect-container" ref={el=>{dropdownRefs.current[key]=el}}>
                            <button className="multiselect-trigger-btn" onClick={()=>setOpenDropdown(openDropdown===key? null: key)}>
                              <span>{(multiFilters[key]?.length? `${multiFilters[key].length} sel` : "All")}</span><ChevronDown size={10}/>
                            </button>
                            {openDropdown===key && (
                              <div className="multiselect-dropdown-panel">
                                <div className="multiselect-actions"><button className="multiselect-action-btn" onClick={()=>clearFilter(key)}>Clear</button><button className="multiselect-action-btn" onClick={()=>selectAllFilter(key, uniqueCache)}>All</button></div>
                                <div className="multiselect-options-list">
                                  {uniqueCache.map(v=>(
                                    <label key={v} className="multiselect-option-label"><input type="checkbox" checked={!!multiFilters[key]?.includes(v)} onChange={()=>toggleFilter(key,v)} />{v}</label>
                                  ))}
                                  {uniqueCache.length===0 && <div className="text-xs text-gray-400 p-2">No options</div>}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (BOOLEAN_COLS.has(key) || key==="dailyLogCheck") ? (
                          <div className="custom-multiselect-container" ref={el=>{dropdownRefs.current[key]=el}}>
                            <button className="multiselect-trigger-btn" onClick={()=>setOpenDropdown(openDropdown===key? null:key)}><span>{multiFilters[key]?.length? `${multiFilters[key].length} sel`:"All"}</span><ChevronDown size={10}/></button>
                            {openDropdown===key && (
                              <div className="multiselect-dropdown-panel">
                                <div className="multiselect-actions"><button className="multiselect-action-btn" onClick={()=>clearFilter(key)}>Clear</button><button className="multiselect-action-btn" onClick={()=>selectAllFilter(key, ["Yes","No","(Blank)"])}>All</button></div>
                                <div className="multiselect-options-list">
                                  {["Yes","No","(Blank)"].map(v=>(
                                    <label key={v} className="multiselect-option-label"><input type="checkbox" checked={!!multiFilters[key]?.includes(v)} onChange={()=>toggleFilter(key,v)} />{v}</label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ): null}
                        {/* text search for string cols */}
                        {key!=="dailyLogCheck" && !BOOLEAN_COLS.has(key) && (
                          <input className="column-search-input" placeholder="Search..." value={columnSearchText[key]||""} onClick={e=>e.stopPropagation()} onChange={e=> setColumnSearchText(prev=>({...prev, [key]: e.target.value}))} />
                        )}
                      </div>
                    )}
                    <div className="column-resizer" onMouseDown={e=>handleResizeStart(e,key,w)} />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {processed.length===0 ? (
              <tr><td colSpan={visibleColumns.length} className="text-center py-8 text-sm text-gray-500">No SOP rows — try clearing filters or seed TenderMerged columns via Admin→SOP.</td></tr>
            ) : processed.map(r=>{
              const log = dailyLogs.get(r.id);
              const isChecked = !!log?.isChecked;
              return (
                <tr key={r.id} className="tender-row">
                  {visibleColumns.map(col=>{
                    const key=String(col.accessor);
                    const w = columnWidths[key] ?? col.defaultWidth;
                    return (
                      <td key={key} className={col.sticky?"sticky-col":undefined} style={col.sticky?{left: stickyOffsets[key]}:{}}>
                        {col.accessor==="columnName" && <span className="font-semibold text-brand">{r.columnName}</span>}
                        {col.accessor==="description" && <div className="cell-scroll-wrap" title={r.description||""}>{r.description||"-"}</div>}
                        {col.accessor==="doneFromWhere" && <div className="cell-scroll-wrap">{r.doneFromWhere||"-"}</div>}
                        {col.accessor==="source" && <span className={`status-badge ${r.source==="MANUAL"?"submitted": r.source==="AI"?"eval":""}`}>{r.source||"-"}</span>}
                        {col.accessor==="isManual" && <span>{r.isManual? "Yes":"No"}</span>}
                        {col.accessor==="allocatedTo" && <span>{r.allocatedTo||"-"}</span>}
                        {col.accessor==="email" && (r.email? <a href={`mailto:${r.email}`} className="text-brand underline text-xs">{r.email}</a> : <span>-</span>)}
                        {col.accessor==="dailyLogCheck" && (
                          <label className="inline-flex items-center justify-center w-full">
                            <input type="checkbox" checked={isChecked} disabled={!isAuthenticated || togglingId===r.id || !r.dailyLogEnabled} onChange={()=>onToggle(r.id, isChecked)} className="h-4 w-4 rounded border-gray-300 text-brand disabled:opacity-30" />
                          </label>
                        )}
                        {col.accessor==="dailyLogEnabled" && <span>{r.dailyLogEnabled? "Yes":"No"}</span>}
                        {col.accessor==="dateEnabled" && <span>{r.dateEnabled? "Yes":"No"}</span>}
                        {col.accessor==="date" && <div className="text-xs text-gray-500">{log?.isChecked? <span>by <b>{log.checkedBy}</b></span> : <span className="text-gray-400">not done for {selectedDate}</span>}<div className="text-[11px]">{r.date? new Date(r.date).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"}):""}</div></div>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="tender-table-footer">
        <div className="footer-left">{processed.length} of {rows.length} rows — IST {selectedDate} {!isAuthenticated && <span className="text-amber-600 ml-2">Sign in to tick</span>}</div>
        <div className="footer-center text-xs">{visibleColumns.length} cols</div>
        <div className="footer-right text-xs text-gray-400">Post-Tender parity: resizer, dropdown, search, sort, picker</div>
      </div>
    </div>
  )
}
