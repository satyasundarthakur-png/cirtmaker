import { createFileRoute } from "@tanstack/react-router";
import CertificateMaker from "@/features/certmaker/CertificateMaker";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Certificate Maker — Design & Bulk Export" },
    { name: "description", content: "Create personalised certificates with custom templates, text effects and signatures. Export PDF and PNG certificates individually or in bulk, privately in your browser." },
    { property: "og:title", content: "Certificate Maker — Design & Bulk Export" },
    { property: "og:description", content: "Design personalised certificates and download PDF or PNG files individually or in bulk." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: CertificateMaker,
});
