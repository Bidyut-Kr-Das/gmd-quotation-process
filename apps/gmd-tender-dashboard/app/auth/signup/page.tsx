import SignupForm from "@/components/SignupForm"

export const dynamic = "force-dynamic"

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <SignupForm />
      </div>
    </div>
  )
}
