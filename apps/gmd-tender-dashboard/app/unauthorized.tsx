import Link from "next/link"

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold text-brand">401</h1>
      <p className="text-gray-600">You are not authorized to access this page.</p>
      <Link
        href="/auth/login"
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-accent"
      >
        Go to Login
      </Link>
    </div>
  )
}
