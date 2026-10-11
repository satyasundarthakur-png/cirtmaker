import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, BadgeCheck, Ban, SearchX } from "lucide-react";
import { checkLink, lookupIssued, type CheckResult, type Issued } from "@/features/certmaker/lib/verify";

interface Search {
  d?: string;
  h?: string;
}

export const Route = createFileRoute("/verify/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["d"] === "string" ? { d: s["d"] } : {}),
    ...(typeof s["h"] === "string" ? { h: s["h"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Verify a certificate" },
      { name: "description", content: "Check that a certificate is genuine and unaltered." },
      { property: "og:title", content: "Certificate Maker — Verify a Certificate" },
      { property: "og:description", content: "Check certificate details against their checksum and this browser's issue register." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VerifyPage,
});

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function VerifyPage() {
  const { id } = Route.useParams();
  const { d, h } = Route.useSearch();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [issued, setIssued] = useState<Issued | undefined>();

  useEffect(() => {
    let live = true;
    checkLink(id, d, h).then((r) => live && setResult(r));
    setIssued(lookupIssued(id));
    return () => {
      live = false;
    };
  }, [id, d, h]);

  const revoked = issued?.revoked === true;
  const record = result && result.status !== "no-record" ? result.record : null;
  const shown = record ?? (issued ? { id: issued.id, name: issued.name, title: issued.title, org: issued.org, date: issued.date } : null);

  let tone = "border-line";
  let icon = <SearchX className="size-6" aria-hidden />;
  let heading = "No record found";
  let text = "This link has no certificate details attached and nothing matching it was issued from this browser.";
  if (revoked) {
    tone = "border-destructive";
    icon = <Ban className="size-6 text-destructive" aria-hidden />;
    heading = "Certificate revoked";
    text = "The issuer has withdrawn this certificate. It should not be relied on.";
  } else if (result?.status === "altered") {
    tone = "border-amber-400";
    icon = <AlertTriangle className="size-6 text-amber-600" aria-hidden />;
    heading = "Details do not match";
    text = "The checksum in this link does not match the certificate details. The link or QR code may have been edited or damaged.";
  } else if (result?.status === "intact") {
    tone = "border-emerald-500";
    icon = <BadgeCheck className="size-6 text-emerald-600" aria-hidden />;
    heading = "Record is intact";
    text = issued
      ? "The details match their checksum and this certificate ID is also in this browser's issue register."
      : "The details match their checksum. They have not been changed since the QR code was created.";
  } else if (issued) {
    tone = "border-emerald-500";
    icon = <BadgeCheck className="size-6 text-emerald-600" aria-hidden />;
    heading = "Found in the issue register";
    text = "This certificate ID was issued from this browser.";
  }

  return (
    <div className="min-h-screen bg-paper px-4 py-10">
      <div className="mx-auto max-w-lg">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wide text-muted">Certificate verification</p>
        <section className={`rounded-2xl border-2 bg-card p-6 shadow-sm ${tone}`} aria-live="polite">
          <div className="flex items-start gap-3">
            {icon}
            <div>
              <h1 className="font-display text-xl font-bold leading-tight">{heading}</h1>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          </div>
          {shown && (
            <dl className="mt-5">
              <Row k="Certificate ID" v={shown.id} />
              <Row k="Awarded to" v={shown.name} />
              <Row k="Title" v={shown.title} />
              <Row k="Issued by" v={shown.org} />
              <Row k="Date" v={shown.date} />
            </dl>
          )}
          {!shown && <p className="mt-4 font-mono text-sm">{id}</p>}
        </section>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          A matching checksum shows the details are unchanged; it cannot by itself prove who created them. For legally binding checks, confirm the ID with the issuing organisation.
        </p>
        <p className="mt-6 text-center text-sm">
          <Link to="/" className="text-brand underline">Create certificates</Link>
        </p>
      </div>
    </div>
  );
}
