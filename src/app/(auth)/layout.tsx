import { Logo } from "@/components/brand";
import { FileCheck2, Link2, ShieldCheck, UploadCloud } from "lucide-react";

const POINTS = [
  { icon: UploadCloud, title: "Hundreds of PDFs at once", text: "Drag in a folder, watch every file upload in parallel." },
  { icon: Link2, title: "A public link for each file", text: "Copy one, copy all, or export to CSV, Excel and TXT." },
  { icon: ShieldCheck, title: "Direct to object storage", text: "Files upload straight to storage, not through the app. Revoke any link anytime." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-xs text-faint">
          Uploaded PDFs are public to anyone who has the link.
        </p>
      </div>

      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div
          aria-hidden
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(900px 500px at 85% -10%, rgb(79 70 229 / 0.55), transparent 60%), radial-gradient(700px 500px at -10% 110%, rgb(99 102 241 / 0.35), transparent 60%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative flex h-full flex-col justify-center px-14 xl:px-20">
          <div className="mb-10 flex size-12 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20 backdrop-blur">
            <FileCheck2 className="size-6" />
          </div>
          <h2 className="max-w-md text-[34px] font-semibold leading-[1.15] tracking-tight text-white">
            From a folder of PDFs to a list of links in minutes.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-indigo-200 ring-1 ring-white/15">
                  <Icon className="size-[18px]" />
                </span>
                <div>
                  <p className="text-[15px] font-medium text-white">{title}</p>
                  <p className="mt-0.5 text-sm text-indigo-100/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
