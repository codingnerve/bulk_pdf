import "server-only";
import ExcelJS from "exceljs";
import { FileModel } from "@/models/File";
import { formatBytes } from "@/lib/utils";
import type { Scope } from "@/lib/auth/scope";

export interface ExportInput {
  ids?: string[];
  batchId?: string;
  includeAll: boolean;
}

export interface ExportRow {
  filename: string;
  url: string;
  size: number;
  uploadedAt: Date;
  status: string;
}

const MAX_ROWS = 50000;

/** Default = successful uploads that still have a live public link. */
export async function collectExportRows(scope: Scope, input: ExportInput): Promise<ExportRow[]> {
  const filter: Record<string, unknown> = { workspaceId: scope.workspaceId };
  if (input.ids) filter._id = { $in: input.ids };
  if (input.batchId) filter.batchId = input.batchId;
  if (!input.includeAll) Object.assign(filter, { uploadStatus: "completed", isPublic: true });

  const docs = await FileModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .select("displayName publicUrl size uploadedAt createdAt uploadStatus isPublic")
    .lean();
  return docs.map((d) => ({
    filename: d.displayName,
    url: d.isPublic && d.uploadStatus === "completed" ? d.publicUrl : "",
    size: d.size,
    uploadedAt: d.uploadedAt ?? d.createdAt,
    status:
      d.uploadStatus === "completed" && !d.isPublic ? "revoked" : d.uploadStatus,
  }));
}

/** Neutralise spreadsheet formula injection and quote per RFC 4180. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  const header = ["Filename", "Public URL", "File Size", "Upload Date", "Status"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.filename, r.url, formatBytes(r.size), r.uploadedAt.toISOString(), r.status]
        .map(csvCell)
        .join(","),
    );
  }
  // BOM so Excel detects UTF-8 filenames correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function toTxt(rows: ExportRow[]): string {
  return rows
    .filter((r) => r.url)
    .map((r) => r.url)
    .join("\n")
    .concat(rows.some((r) => r.url) ? "\n" : "");
}

export async function toXlsx(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PDFLinker";
  wb.created = new Date();
  const ws = wb.addWorksheet("PDF Links", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Filename", key: "filename", width: 46 },
    { header: "Public URL", key: "url", width: 72 },
    { header: "File Size", key: "size", width: 14 },
    { header: "Upload Date", key: "date", width: 22 },
    { header: "Status", key: "status", width: 14 },
  ];
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
    c.alignment = { vertical: "middle", horizontal: "left" };
  });
  rows.forEach((r, i) => {
    const row = ws.addRow({
      filename: r.filename,
      url: r.url,
      size: formatBytes(r.size),
      date: r.uploadedAt,
      status: r.status,
    });
    // Plain-text cells for user-controlled strings (no formula evaluation).
    row.getCell("filename").value = { richText: [{ text: r.filename }] };
    if (r.url) {
      row.getCell("url").value = { text: r.url, hyperlink: r.url };
      row.getCell("url").font = { color: { argb: "FF4338CA" }, underline: true };
    }
    row.getCell("date").numFmt = "yyyy-mm-dd hh:mm";
    row.getCell("size").alignment = { horizontal: "right" };
    if (i % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F6FA" } };
      });
    }
  });
  ws.autoFilter = { from: "A1", to: "E1" };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
