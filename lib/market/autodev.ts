// lib/market/autodev.ts
export type AutoDevListing = any;

export type AutoDevSearchParams = {
  year?: string;          // "2003-2004"
  make?: string;
  model?: string;
  trim?: string;
  transmission?: string;  // "manual"|"automatic"
  exteriorColor?: string; // e.g. "yellow"
  price?: string;         // "0-30000"
  miles?: string;         // "0-80000"
  state?: string;         // "CA"
  page?: number;          // 1-based
  limit?: number;         // 1-100
  sort?: string;          // "price.asc", "mileage.asc", etc.
};

function buildQuery(p: AutoDevSearchParams) {
  const q = new URLSearchParams();
  q.set("page", String(p.page ?? 1));
  q.set("limit", String(p.limit ?? 50));
  if (p.sort) q.set("sort", p.sort);

  if (p.year) q.set("vehicle.year", p.year);
  if (p.make) q.set("vehicle.make", p.make);
  if (p.model) q.set("vehicle.model", p.model);
  if (p.trim) q.set("vehicle.trim", p.trim);
  if (p.transmission) q.set("vehicle.transmission", p.transmission);
  if (p.exteriorColor) q.set("vehicle.exteriorColor", p.exteriorColor);

  if (p.price) q.set("retailListing.price", p.price);
  if (p.miles) q.set("retailListing.miles", p.miles);
  if (p.state) q.set("retailListing.state", p.state);

  return q.toString();
}

export async function searchAutoDevListings(params: AutoDevSearchParams) {
  const apiKey = process.env.AUTODEV_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AUTODEV_API_KEY");
  }

  const qs = buildQuery(params);
  const url = `https://api.auto.dev/listings?${qs}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    // Node/Next fetch supports AbortSignal, handled by caller for demo safety
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Auto.dev error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  // Expected: { data: [...] }
  return (json?.data ?? []) as AutoDevListing[];
}
