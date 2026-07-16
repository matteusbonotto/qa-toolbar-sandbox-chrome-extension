export function calculateRutVerifier(body: number): string {
  let sum = 0;
  let multiplier = 2;
  for (const digit of String(body).split("").reverse()) {
    sum += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? "0" : result === 10 ? "K" : String(result);
}

export function generateRut(random = Math.random): string {
  const body = Math.floor(5_000_000 + random() * 20_000_000);
  return `${new Intl.NumberFormat("es-CL").format(body)}-${calculateRutVerifier(body)}`;
}
