import "next-auth"
import "@auth/core/jwt"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string
    role: string
  }
}
