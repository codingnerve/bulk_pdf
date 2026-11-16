"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { passwordSchema } from "@/lib/validators/password-rule";
import { errorMessage, post } from "@/lib/api-client";

const email = z.string().trim().min(1, "Email is required").email("Enter a valid email");

function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

function Heading({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- login
const loginSchema = z.object({ email, password: z.string().min(1, "Password is required") });

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [formError, setFormError] = React.useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError("");
    try {
      await post("/api/v1/auth/login", { ...values, client: "web" });
      router.replace(next);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  return (
    <>
      <Heading title="Welcome back" subtitle="Sign in to manage your PDFs and links." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" aria-invalid={!!errors.email} {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="mb-1.5 text-xs font-medium text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New to PDFLinker?{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- register
const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    email,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite") ?? undefined;
  const invitedEmail = params.get("email") ?? "";
  const [formError, setFormError] = React.useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: inviteToken ? invitedEmail : "" },
  });

  const onSubmit = handleSubmit(async ({ name, email, password }) => {
    setFormError("");
    try {
      await post("/api/v1/auth/register", { name, email, password, client: "web", inviteToken });
      toast.success(inviteToken ? "Welcome to the team!" : "Welcome to PDFLinker!");
      router.replace("/dashboard");
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  return (
    <>
      <Heading
        title={inviteToken ? "Join your team" : "Create your account"}
        subtitle={inviteToken ? "Create your account to accept the invitation." : "Start turning PDFs into shareable links."}
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...register("name")} />
          <FieldError message={errors.name?.message} />
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" readOnly={!!inviteToken} aria-invalid={!!errors.email} {...register("email")} />
          <FieldError message={errors.email?.message} />
          {inviteToken && <p className="mt-1.5 text-xs text-faint">This is the address your invitation was sent to.</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
          <FieldError message={errors.password?.message} />
          {!errors.password && <p className="mt-1.5 text-xs text-faint">At least 8 characters with a letter and a number.</p>}
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
          <FieldError message={errors.confirm?.message} />
        </div>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- forgot
export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState<{ devLink?: string } | null>(null);
  const [formError, setFormError] = React.useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email })) });

  const onSubmit = handleSubmit(async (v) => {
    setFormError("");
    try {
      const res = await post<{ devLink?: string }>("/api/v1/auth/forgot-password", v);
      setSent({ devLink: res.devLink });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  if (sent) {
    return (
      <>
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success">
          <MailCheck className="size-6" />
        </div>
        <Heading title="Check your inbox" subtitle="If an account exists for that email, a reset link is on its way. It expires in 1 hour." />
        {sent.devLink && (
          <div className="mb-6 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
            <b>Development mode:</b> no email provider is configured, so use this link directly:
            <Link href={sent.devLink.replace(/^https?:\/\/[^/]+/, "")} className="mt-1 block break-all font-medium underline">
              {sent.devLink}
            </Link>
          </div>
        )}
        <Link href="/login" className="text-sm font-medium text-accent hover:underline">
          ← Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <Heading title="Reset your password" subtitle="Enter your email and we'll send you a reset link." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        {formError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- reset
const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [formError, setFormError] = React.useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError("");
    try {
      await post("/api/v1/auth/reset-password", { token, password });
      toast.success("Password updated. Please sign in.");
      router.replace("/login");
    } catch (e) {
      setFormError(errorMessage(e));
    }
  });

  if (!token) {
    return (
      <>
        <Heading title="Link not valid" subtitle="This reset link is missing its token. Request a new one." />
        <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
          Request a new link
        </Link>
      </>
    );
  }
  return (
    <>
      <Heading title="Choose a new password" subtitle="You'll be signed out of all other devices." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="password">New password</Label>
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
          <FieldError message={errors.confirm?.message} />
        </div>
        {formError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </>
  );
}
