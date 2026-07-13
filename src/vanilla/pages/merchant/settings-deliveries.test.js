import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  buildBusinessHours,
  buildSettingsRequest,
  normalizeBusinessHours,
  normalizePixKey,
  settingsAssetPath,
  uploadSettingsAsset,
} from "./settings.js";
import {
  buildZonePayload,
  formatCep,
  quoteAddressLabel,
  zoneCoverageKind,
  zoneCoverageLabel,
} from "./deliveries.js";

const settingsValues = {
  public_name: "Café Hype",
  whatsapp: "(11) 99999-8888",
  logo_url: "/storage/store-assets/store-1/branding/logo/a.png",
  cover_url: "https://cdn.example.test/cover.webp",
  description: "Café, almoço e entrega.",
  zip_code: "01310-100",
  address: "Avenida Paulista",
  address_number: "1000",
  address_complement: "Loja 2",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "sp",
  primary_color: "#B2D83F",
  secondary_color: "#303938",
  avg_prep_time_minutes: "35",
  min_order_value: "20.50",
  delivery_radius_km: "12.5",
  is_open: true,
  allow_delivery: true,
  allow_pickup: true,
  accept_orders_when_closed: false,
  accept_pix: true,
  accept_cash: true,
  accept_card_on_delivery: false,
  pix_key_type: "CNPJ",
  pix_key: "AB.CD1.23456/7890",
  payment_instructions: "Envie o comprovante.",
};

describe("merchant atomic settings", () => {
  it("normalizes seven business days and validates enabled schedules", () => {
    const normalized = normalizeBusinessHours({ mon: { enabled: true, open: "08:30", close: "18:15" } });
    expect(Object.keys(normalized)).toHaveLength(7);
    expect(normalized.mon).toEqual({ enabled: true, open: "08:30", close: "18:15" });
    expect(normalized.sun).toEqual({ enabled: false, open: "09:00", close: "18:00" });

    const values = { hours_mon_enabled: true, hours_mon_open: "19:00", hours_mon_close: "02:00" };
    expect(buildBusinessHours(values).mon).toEqual({ enabled: true, open: "19:00", close: "02:00" });
    expect(() => buildBusinessHours({ ...values, hours_mon_close: "19:00" })).toThrow("não podem ser iguais");
  });

  it("builds the exact store/settings body without leaking gateway credentials", () => {
    const hours = normalizeBusinessHours({ mon: { enabled: true, open: "08:00", close: "17:00" } });
    const payload = buildSettingsRequest(settingsValues, hours);
    expect(payload.store).toMatchObject({
      public_name: "Café Hype",
      whatsapp: "11999998888",
      zip_code: "01310100",
      state: "SP",
      primary_color: "#b2d83f",
    });
    expect(payload.settings).toMatchObject({
      avg_prep_time_minutes: 35,
      min_order_value: 20.5,
      delivery_radius_km: 12.5,
      pix_key_type: "CNPJ",
      pix_key: "ABCD1234567890",
      business_hours: hours,
    });
    expect(JSON.stringify(payload)).not.toMatch(/api_key|wallet|gateway/i);
  });

  it("validates Pix types while supporting the alphanumeric CNPJ format", () => {
    expect(normalizePixKey("CNPJ", "AB.CD1.23456/7890")).toBe("ABCD1234567890");
    expect(() => buildSettingsRequest({ ...settingsValues, pix_key_type: "COPY_PASTE", pix_key: "123" }, {}))
      .toThrow("deve começar com 000201");
    expect(() => buildSettingsRequest({ ...settingsValues, allow_delivery: false, allow_pickup: false }, {}))
      .toThrow("Ative entrega ou retirada");
  });

  it("uploads branding to an owned, unique store-assets path without upsert", async () => {
    const file = { name: "logo.png", type: "image/png", size: 1024 };
    expect(settingsAssetPath("store-1", "logo", file, () => "asset-1"))
      .toBe("store-1/branding/logo/asset-1.png");
    const upload = vi.fn(async (_bucket, path) => ({ data: { path }, error: null }));
    const url = await uploadSettingsAsset({ api: { upload } }, {
      storeId: "store-1", kind: "cover", file, createId: () => "asset-2",
    });
    expect(upload).toHaveBeenCalledWith("store-assets", "store-1/branding/cover/asset-2.png", file, { upsert: false });
    expect(url).toBe("/storage/store-assets/store-1/branding/cover/asset-2.png");
  });

  it("uses only the atomic backend function to save store and settings", async () => {
    const source = await readFile(new URL("settings.js", import.meta.url), "utf8");
    expect(source).toContain('ctx.api.fn("merchant-update-settings"');
    expect(source).not.toMatch(/from\("stores"\)\.update/);
    expect(source).not.toMatch(/from\("store_settings"\)\.(?:update|upsert)/);
  });
});

describe("merchant delivery rules", () => {
  const completeZone = {
    name: "Centro expandido",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "sp",
    zip_start: "01000-000",
    zip_end: "01599-999",
    max_radius_km: "12.5",
    fee: "6",
    fee_per_km: "1.25",
    min_fee: "8",
    max_fee: "28",
    min_order: "30",
    base_prep_time: "25",
    minutes_per_km: "4",
    additional_region_time: "10",
    priority: "20",
    is_active: true,
    internal_notes: "Evitar Marginal em horário de pico.",
  };

  it("maps every field consumed by server-side delivery pricing and timing", () => {
    expect(buildZonePayload(completeZone)).toEqual({
      name: "Centro expandido",
      neighborhood: "CENTRO",
      city: "SÃO PAULO",
      state: "SP",
      zip_start: "01000000",
      zip_end: "01599999",
      max_radius_km: 12.5,
      fee: 6,
      fee_per_km: 1.25,
      min_fee: 8,
      max_fee: 28,
      min_order: 30,
      base_prep_time: 25,
      minutes_per_km: 4,
      additional_region_time: 10,
      estimated_minutes: 35,
      priority: 20,
      is_active: true,
      internal_notes: "Evitar Marginal em horário de pico.",
    });
  });

  it("rejects ambiguous CEP and fee rules before mutation", () => {
    expect(() => buildZonePayload({ ...completeZone, zip_end: "" })).toThrow("CEP inicial e o final");
    expect(() => buildZonePayload({ ...completeZone, zip_start: "02000-000", zip_end: "01000-000" })).toThrow("não pode ser maior");
    expect(() => buildZonePayload({ ...completeZone, min_fee: "30", max_fee: "10" })).toThrow("taxa mínima");
    expect(() => buildZonePayload({ ...completeZone, priority: "1.5" })).toThrow("número inteiro");
  });

  it("explains coverage and canonical server addresses without color-only meaning", () => {
    expect(formatCep("01310100")).toBe("01310-100");
    expect(zoneCoverageKind(completeZone)).toBe("Faixa de CEP");
    expect(zoneCoverageLabel(completeZone)).toBe("01000-000 a 01599-999");
    expect(zoneCoverageKind({ city: "Campinas", state: "SP", neighborhood: "GERAL" })).toBe("Cidade/UF");
    expect(quoteAddressLabel({ cep: "01310100", street: "Av. Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" }))
      .toContain("01310-100");
  });

  it("resolves CEP through quote-delivery and keeps CSP/DOM sinks safe", async () => {
    const [source, css] = await Promise.all([
      readFile(new URL("deliveries.js", import.meta.url), "utf8"),
      readFile(new URL("merchant.css", import.meta.url), "utf8"),
    ]);
    expect(source).toContain('ctx.api.fn("quote-delivery"');
    expect(source).not.toMatch(/viacep\.com|fetch\s*\(/i);
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(source).not.toMatch(/\.style\s*[.=]/);
    expect(css).toContain(".merchant-zone__radius meter");
  });
});
