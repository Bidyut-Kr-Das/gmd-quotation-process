import SignupForm from "@/components/SignupForm"

export const dynamic = "force-dynamic"

export default function SignupPage() {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <SignupForm />
      </div>
    </div>
  )
}
