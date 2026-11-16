import { api, RATE } from "@/lib/api/handler";
import { exportSchema } from "@/lib/validators/schemas";
import { collectExportRows, toXlsx } from "@/services/export.service";

export const POST = api({ body: exportSchema, rateLimit: RATE.export }, async ({ auth, body }) => {
  const rows = await collectExportRows(auth, body);
  const stamp = new Date().toISOString().slice(0, 10);
  const buf = await toXlsx(rows);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pdflinker-links-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Export-Count": String(rows.length),
    },
  });
});
