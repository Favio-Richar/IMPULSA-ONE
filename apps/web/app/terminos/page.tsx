import { MarketingFooter } from "../../components/marketing/footer";
import { BrandedMarketingHeader } from "../../components/marketing/branded-header";
import { getDashboardLinks } from "../../lib/dashboard-links";

// Términos del servicio (F4.6c, ADR-012). La versión de este texto es `LEGAL_DOCUMENT_VERSIONS`
// (`@impulza/validation`): si el texto cambia de fondo, se sube la versión allá y cada nueva
// contratación queda registrada con la versión que aceptó. Texto base redactado para cumplir la Ley
// 19.496 (reformada por la Ley 21.398); requiere revisión legal del propietario antes de cobrar en
// producción (ADR-012, "Seguimiento").

export const metadata = {
  title: "Términos del servicio — Impulza One",
  description: "Condiciones de uso de Impulza One: planes, precios, renovación, cancelación, derecho a retracto y reembolsos.",
};

const SECTIONS: Array<{ id: string; title: string; paragraphs: string[] }> = [
  {
    id: "servicio",
    title: "1. El servicio",
    paragraphs: [
      "Impulza One es una plataforma para crear y administrar la presencia digital de un negocio: página pública, formularios, contactos, reservas, catálogo, campañas y analítica.",
      "Puedes usar el plan Gratis sin límite de tiempo y sin entregar un medio de pago. Los planes de pago amplían los límites y funciones según se detalla en la página de Planes.",
    ],
  },
  {
    id: "precios",
    title: "2. Planes y precios",
    paragraphs: [
      "Los precios se informan en pesos chilenos e incluyen IVA. Antes de pagar verás el total a cobrar, el ciclo (mensual o anual) y la fecha del próximo cobro.",
      "Si cambiamos el precio de un plan, te avisaremos por correo con al menos 30 días de anticipación, y el nuevo precio se aplicará recién desde la renovación siguiente a ese aviso.",
    ],
  },
  {
    id: "pago",
    title: "3. Pago y renovación automática",
    paragraphs: [
      "El pago se procesa a través de Webpay (Transbank) u otra pasarela autorizada que elijas al contratar. Impulza One nunca recibe ni guarda los datos completos de tu tarjeta: solo una referencia entregada por la pasarela y los últimos cuatro dígitos para que la reconozcas.",
      "Tu plan se renueva automáticamente al término de cada período por el mismo monto, hasta que lo canceles. Cada cobro te llega confirmado por correo.",
      "Si un cobro es rechazado, tu plan sigue activo durante 7 días mientras reintentamos el cobro. Si no se logra, tu cuenta pasa al plan Gratis. Nunca borramos lo que creaste por un problema de pago: solo no podrás crear más allá de los límites del plan Gratis.",
    ],
  },
  {
    id: "cancelacion",
    title: "4. Cancelación",
    paragraphs: [
      "Puedes cancelar tu plan cuando quieras desde \"Plan y pagos\" en tu panel, el mismo medio por el que lo contrataste, con un clic y sin trámites adicionales.",
      "Al cancelar no se vuelve a cobrar. Tu plan sigue activo hasta el fin del período ya pagado y después tu cuenta pasa al plan Gratis. Mientras el período siga vigente, puedes reanudarlo.",
    ],
  },
  {
    id: "retracto",
    title: "5. Derecho a retracto",
    paragraphs: [
      "Conforme al artículo 3 bis letra b) de la Ley 19.496, tienes derecho a retractarte de la contratación dentro de los 10 días siguientes al primer cobro, sin expresar causa.",
      "Para ejercerlo, usa \"Cancelar y pedir reembolso\" en \"Plan y pagos\". Cancelamos el plan de inmediato y reembolsamos el 100 % del monto pagado al mismo medio de pago. Según tu banco, el reembolso puede tardar algunos días hábiles en verse en tu estado de cuenta.",
    ],
  },
  {
    id: "reembolsos",
    title: "6. Reembolsos fuera del plazo de retracto",
    paragraphs: [
      "Fuera del plazo de retracto, al cancelar conservas el plan hasta el fin del período pagado y no se reembolsa ese período. Si un cobro fue un error nuestro, lo devolvemos completo: escríbenos desde Soporte en tu panel.",
    ],
  },
  {
    id: "documentos",
    title: "7. Documentos tributarios",
    paragraphs: [
      "Por cada cobro emitimos el documento tributario electrónico que corresponda (boleta o factura) conforme a la normativa del Servicio de Impuestos Internos.",
    ],
  },
  {
    id: "uso",
    title: "8. Uso aceptable",
    paragraphs: [
      "No puedes usar Impulza One para publicar contenido ilegal, engañoso o que infrinja derechos de terceros, ni para enviar comunicaciones comerciales a personas que no las aceptaron. Podemos suspender una cuenta que incumpla estas reglas, informándote el motivo.",
    ],
  },
  {
    id: "datos",
    title: "9. Datos personales",
    paragraphs: [
      "Tratamos los datos personales conforme a la Ley 19.628 y a la Ley 21.719. Tus datos y los de tus contactos son tuyos: puedes exportarlos o pedir su eliminación desde tu panel o escribiéndonos.",
    ],
  },
  {
    id: "contacto",
    title: "10. Contacto",
    paragraphs: ["Para cualquier consulta sobre estos términos, escríbenos desde Soporte en tu panel."],
  },
];

export default function TerminosPage() {
  const { bienvenidaHref, loginHref } = getDashboardLinks();
  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <BrandedMarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Términos del servicio</h1>
        <p className="mt-3 text-sm text-[#475569]">Vigentes desde el 29 de septiembre de 2026.</p>

        <nav aria-label="Secciones" className="mt-8 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-[#0f6f6b] underline-offset-2 hover:underline">
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          {SECTIONS.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-titulo`} className="scroll-mt-24">
              <h2 id={`${section.id}-titulo`} className="text-xl font-semibold">
                {section.title}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-relaxed text-[#334155]">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>
      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
