import LoginForm from "@/components/LoginForm"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
