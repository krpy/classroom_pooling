import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const readingPath = path.join(rootDir, "Alza_Platebni_Ekonomika_OnePager_v2.docx");

let cachedReading = null;

function mobileReadingHtml(rawHtml) {
  return `
    <div class="reading-doc">
      ${rawHtml}
    </div>
  `;
}

export async function getDefaultReading() {
  if (cachedReading) return cachedReading;
  const converted = await mammoth.convertToHtml(
    { path: readingPath },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
      ],
    }
  );

  cachedReading = {
    id: "alza-platebni-ekonomika",
    title: "Alza: Platební ekonomika",
    html: mobileReadingHtml(converted.value),
    warnings: converted.messages,
  };
  return cachedReading;
}
