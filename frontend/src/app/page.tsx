import { redirect } from "next/navigation";

export default function Page() {
  // Redirect root to the companies listing since there's no home screen.
  redirect("/companies");
}
