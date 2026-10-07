"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { History, RefreshCw, Search, ChevronLeft, ChevronRight } from "lucide-react"

interface ActivityLog {
  id: string
  userId: string | null
  userName: string | null
  userEmail: string | null
  action: string
  tableName: string
  recordId: string | null
  referenceNo: string | null
  details: string | null
  createdAt: string
}

interface ActivityResponse {
  logs: ActivityLog[]
  total: number
  page: number
  pageSize: number
}

const ACTION_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
}

const UNIQUE_TABLES = [
  "Tender",
  "GemTender",
  "NonGemTender",
  "ColumnMapping",
  "ColumnGroup",
  "TenderAssociation",
  "UtilityMapping",
  "User",
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
}

export default function ActivityPage() {
  const { data: session } = useSession()
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [userFilter, setUserFilter] = useState("")
  const [tableFilter, setTableFilter] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const totalPages = Math.ceil(total / pageSize)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      if (userFilter) params.set("user", userFilter)
      if (tableFilter) params.set("table", tableFilter)

      const res = await fetch(`/api/activity?${params}`)
      if (!res.ok) throw new Error("Failed to fetch")
      const data: ActivityResponse = await res.json()
      setLogs(data.logs)
      setTotal(data.total)
    } catch {
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, userFilter, tableFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSearch = () => {
    setUserFilter(searchInput)
    setPage(1)
  }

  const handleTableFilter = (table: string) => {
    setTableFilter(table === tableFilter ? "" : table)
    setPage(1)
  }

  const handleRefresh = () => {
    fetchLogs()
  }

  return (
    <div className="flex flex-1 flex-col p-6 gap-4" style={{ paddingTop: "12px" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="size-5 text-brand" />
          <h1 className="text-xl font-bold text-brand">Activity Log</h1>
          <span className="text-sm text-gray-500">
            {total > 0 ? `${total} record${total !== 1 ? "s" : ""}` : ""}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
          <Input
            placeholder="Search by user, email or reference no..."
            className="pl-8 h-8"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Table:</span>
          <button
            onClick={() => handleTableFilter("")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              tableFilter === ""
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All
          </button>
          {UNIQUE_TABLES.map((t) => (
            <button
              key={t}
              onClick={() => handleTableFilter(t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                tableFilter === t
                  ? "bg-brand text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Date & Time</TableHead>
              <TableHead className="w-48">User</TableHead>
              <TableHead className="w-20">Action</TableHead>
              <TableHead className="w-32">Table</TableHead>
              <TableHead className="w-44">Reference No</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-gray-400 py-12">
                  Loading...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-12">
                  <History className="size-8 mx-auto mb-2 opacity-40" />
                  No activity records found
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-gray-600 whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium text-gray-900">
                      {log.userName || "Unknown"}
                    </div>
                    <div className="text-xs text-gray-500 truncate max-w-40">
                      {log.userEmail}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={ACTION_VARIANTS[log.action] || "outline"}
                      className="text-[10px] px-1.5 py-0 h-5"
                    >
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-medium text-gray-700">
                      {log.tableName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-600 truncate max-w-40 block">
                      {log.referenceNo || ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-600 line-clamp-2">
                      {log.details || ""}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
