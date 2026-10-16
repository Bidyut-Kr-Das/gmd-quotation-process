import LoginForm from "@/components/LoginForm"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
