import { api, RATE } from "@/lib/api/handler";
import { exportSchema } from "@/lib/validators/schemas";
import { collectExportRows, toTxt } from "@/services/export.service";

export const POST = api({ body: exportSchema, rateLimit: RATE.export }, async ({ auth, body }) => {
  const rows = await collectExportRows(auth, body);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toTxt(rows), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="pdflinker-links-${stamp}.txt"`,
      "Cache-Control": "no-store",
      "X-Export-Count": String(rows.length),
    },
  });
});
