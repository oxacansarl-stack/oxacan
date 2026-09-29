import {
  date, ensureSpace, heading, letterhead, newDocument, PAGE, pageNumbers, paragraph, Sender, table, titleBlock,
  toBuffer, COLORS,
} from './pdf-layout';

export interface MeetingDocumentData {
  sender: Sender;
  project: { reference: string | null; name: string; address: string | null };
  meeting: {
    meetingNumber: number;
    meetingDate: string | Date;
    location: string | null;
    agenda: string | null;
    minutes: string | null;
    status: string;
  };
  attendees: { name: string; role: string | null; organization: string | null; attendance: string }[];
  actions: { description: string; responsible: string; dueDate: string | Date | null; status: string }[];
}

const ATTENDANCE: Record<string, string> = { present: 'Présent', absent: 'Absent', excused: 'Excusé' };
const ACTION_STATUS: Record<string, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  done: 'Terminée',
  cancelled: 'Annulée',
};

const time = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

export async function renderMeetingMinutes(d: MeetingDocumentData): Promise<Buffer> {
  const { meeting, project } = d;
  const title = `PV de chantier n° ${meeting.meetingNumber}`;
  const doc = newDocument(title, d.sender.name);
  const width = PAGE.right - PAGE.left;

  letterhead(doc, d.sender, null);
  titleBlock(doc, title, [
    ['Chantier', [project.reference, project.name].filter(Boolean).join(' – ')],
    ['Adresse', project.address ?? ''],
    ['Date', `${date(meeting.meetingDate)} à ${time.format(new Date(meeting.meetingDate))}`],
    ['Lieu', meeting.location ?? ''],
    ['Statut', meeting.status === 'completed' ? 'Définitif' : 'Provisoire'],
  ]);

  heading(doc, 'Participants');
  table(
    doc,
    [
      { header: 'Nom', width: width * 0.3 },
      { header: 'Fonction', width: width * 0.25 },
      { header: 'Entreprise', width: width * 0.3 },
      { header: 'Présence', width: width * 0.15 },
    ],
    d.attendees.map((a) => [a.name, a.role ?? '', a.organization ?? '', ATTENDANCE[a.attendance] ?? a.attendance]),
  );

  heading(doc, 'Ordre du jour');
  paragraph(doc, meeting.agenda);

  heading(doc, 'Points traités et décisions');
  paragraph(doc, meeting.minutes);

  heading(doc, 'Actions');
  if (d.actions.length === 0) {
    paragraph(doc, 'Aucune action.');
  } else {
    table(
      doc,
      [
        { header: 'N°', width: 30 },
        { header: 'Action', width: width - 280 },
        { header: 'Responsable', width: 110 },
        { header: 'Délai', width: 70 },
        { header: 'Statut', width: 70 },
      ],
      d.actions.map((a, i) => [String(i + 1), a.description, a.responsible, date(a.dueDate), ACTION_STATUS[a.status] ?? a.status]),
    );
  }

  const present = d.attendees.filter((a) => a.attendance === 'present');
  if (present.length) {
    ensureSpace(doc, 60);
    heading(doc, 'Signatures');
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
    const colWidth = (width - 20) / 2;
    present.forEach((a, i) => {
      if (i % 2 === 0) ensureSpace(doc, 45);
      const x = PAGE.left + (i % 2) * (colWidth + 20);
      const y = doc.y + 28;
      doc.moveTo(x, y).lineTo(x + colWidth, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
      doc.fillColor(COLORS.muted).text(a.name, x, y + 3, { width: colWidth });
      if (i % 2 === 0) doc.y = y - 28;
      else doc.y = y + 16;
    });
  }

  doc.moveDown(1);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.muted);
  doc.text(
    'Sans remarque écrite dans les 5 jours suivant sa réception, le présent procès-verbal est considéré comme accepté.',
    PAGE.left,
    doc.y,
    { width },
  );

  pageNumbers(doc);
  return toBuffer(doc);
}
