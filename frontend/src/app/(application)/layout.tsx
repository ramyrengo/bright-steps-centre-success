import { EntraAuthenticationProvider } from "@/lib/centre-success-authentication";

export default function ApplicationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <EntraAuthenticationProvider>{children}</EntraAuthenticationProvider>;
}
