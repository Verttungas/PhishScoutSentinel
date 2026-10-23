/**
 * Data for the Insights panel (signals.js). Lists and phrases come from the
 * classification guide (Carlos's operating criteria and the SEA Training pages);
 * Sublime Security's lists (sublime-data.js) extend the domain lists at runtime.
 * They are hints to look at, never a classification on their own: edit freely.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PeelRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Route keys and the official names shown in the panel.
  const ROUTES = {
    bec: "Malicious → Response → BEC",
    recon: "Malicious → Response → RECON",
    scam419: "Malicious → Response → 419 Scam",
    vishing: "Malicious → Response → Vishing",
    job: "Malicious → Response → Job Scam",
    techsupport: "Malicious → Response → Tech Support Scam",
    o365: "Malicious → Link → O365",
    phishing: "Malicious → Link → Phishing",
    docuphish: "Malicious → Payload → Docuphish",
    firMissingContent: "FIR → Missing Content",
    firMissingHeaders: "FIR → Missing Headers",
    firInternal: "FIR → Internal Communication",
    firEncrypted: "FIR → Content Encrypted",
    simulation: "Simulation",
    dne: "Do Not Engage (hypothesis)",
    ntd: "No Threat Detected (hypothesis)",
  };

  // Free mail / ISP providers (SEA p. 5–7; shaw.ca and gmx.com are named there).
  // Entries ending in "." match any TLD (yahoo.com, yahoo.es, ...).
  const FREEMAIL = [
    "gmail.com", "googlemail.com", "yahoo.", "ymail.com", "rocketmail.com", "outlook.", "hotmail.", "live.", "msn.com",
    "aol.com", "icloud.com", "me.com", "mac.com", "gmx.", "mail.com", "email.com", "proton.me", "protonmail.com", "pm.me",
    "zoho.com", "zohomail.com", "yandex.", "mail.ru", "inbox.ru", "list.ru", "bk.ru", "shaw.ca", "comcast.net", "att.net",
    "sbcglobal.net", "verizon.net", "rogers.com", "sympatico.ca", "telus.net", "cox.net", "bellsouth.net", "earthlink.net",
    "optonline.net", "charter.net", "frontier.com", "windstream.net", "qq.com", "163.com", "126.com", "sina.com", "naver.com",
    "daum.net", "web.de", "t-online.de", "freenet.de", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net",
    "libero.it", "virgilio.it", "tiscali.it", "btinternet.com", "sky.com", "talktalk.net", "rediffmail.com", "fastmail.com",
    "tutanota.com", "tuta.io", "hushmail.com", "inbox.com", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "terra.com.br",
    "uol.com.br", "bol.com.br", "prodigy.net.mx", "infinitummail.com",
  ];

  // Second-level labels under which the registrable domain has three labels.
  // Approximation of the Public Suffix List, good enough for hints.
  const MULTI_LEVEL_SUFFIXES = [
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au", "edu.au", "gov.au",
    "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.kr", "or.kr", "com.mx", "org.mx", "gob.mx", "edu.mx", "net.mx",
    "com.br", "net.br", "org.br", "gov.br", "com.ar", "gob.ar", "com.co", "gov.co", "edu.co", "com.pe", "gob.pe", "com.ve",
    "com.ec", "gob.ec", "cl.cl", "com.uy", "com.py", "com.bo", "com.gt", "com.sv", "com.hn", "com.ni", "co.cr", "com.do",
    "com.pa", "co.za", "org.za", "gov.za", "com.cn", "net.cn", "org.cn", "com.hk", "com.tw", "com.sg", "com.my", "co.in",
    "net.in", "org.in", "gov.in", "co.id", "or.id", "com.ph", "com.tr", "gov.tr", "com.sa", "com.eg", "co.il", "com.es",
    "com.pl", "com.ua", "co.ua", "com.ru", "ru.com", "us.com", "eu.com", "uk.com", "cn.com", "de.com", "br.com", "sa.com",
  ];

  // Brands and the registrable domains they really use. A domain that contains the
  // brand token without being one of these is a lookalike hint (Adobe precedent).
  const BRANDS = {
    microsoft: ["microsoft.com", "office.com", "office365.com", "live.com", "outlook.com", "hotmail.com", "sharepoint.com", "onedrive.com", "microsoftonline.com", "msft.net", "azure.com", "windows.net", "1drv.ms", "msn.com", "microsoft365.com", "cloud.microsoft", "sharepointonline.com", "bing.com"],
    office365: ["office365.com", "office.com", "microsoft.com"],
    sharepoint: ["sharepoint.com", "sharepointonline.com", "microsoft.com"],
    onedrive: ["onedrive.com", "live.com", "microsoft.com", "1drv.ms"],
    outlook: ["outlook.com", "live.com", "office.com", "microsoft.com"],
    google: ["google.com", "gmail.com", "googleusercontent.com", "googleapis.com", "goo.gl", "g.co", "withgoogle.com", "youtube.com", "google.es", "google.com.mx"],
    docusign: ["docusign.com", "docusign.net"],
    adobe: ["adobe.com", "adobesign.com", "acrobat.com", "adobe.io", "adobelogin.com"],
    paypal: ["paypal.com", "paypal.me", "paypalobjects.com", "paypal-community.com"],
    apple: ["apple.com", "icloud.com", "me.com", "mac.com"],
    amazon: ["amazon.com", "amazon.es", "amazon.com.mx", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.ca", "amazonaws.com", "amazonses.com", "a2z.com"],
    dropbox: ["dropbox.com", "dropboxusercontent.com", "db.tt", "dropboxmail.com"],
    netflix: ["netflix.com", "netflix.net"],
    norton: ["norton.com", "nortonlifelock.com", "gen.digital"],
    mcafee: ["mcafee.com"],
    geeksquad: ["geeksquad.com", "bestbuy.com"],
    fedex: ["fedex.com"],
    wetransfer: ["wetransfer.com", "we.tl"],
    linkedin: ["linkedin.com", "lnkd.in"],
    coinbase: ["coinbase.com"],
    binance: ["binance.com"],
    quickbooks: ["intuit.com", "quickbooks.com", "intuit.ca"],
    intuit: ["intuit.com", "quickbooks.com", "intuit.ca"],
    rippling: ["rippling.com"],
    anthropic: ["anthropic.com", "claude.ai", "claude.com"],
    scotiabank: ["scotiabank.com", "scotiabank.ca", "scotiabank.com.uy", "scotiabank.com.mx", "scotiabank.cl", "scotiabank.com.pe", "scotiabank.com.co"],
    desjardins: ["desjardins.com", "desjardins.ca", "dgag.ca"],
    wellsfargo: ["wellsfargo.com", "wf.com"],
    usaa: ["usaa.com"],
    rbcroyalbank: ["rbc.com", "rbcroyalbank.com"],
  };

  // Brands whose name is too short or too common for the domain-substring test above:
  // matched as words in display names, subjects and text.
  const BRAND_WORDS = [
    { name: "TD Bank", re: /\btd ?bank|\btd (canada trust|secure|securities|ameritrade)\b|\btdbank/i, domains: ["td.com", "tdbank.com", "tdcanadatrust.com", "tdsecurities.com", "tdassurance.com"] },
    { name: "RBC", re: /\brbc\b|royal bank of canada/i, domains: ["rbc.com", "rbcroyalbank.com"] },
    { name: "National Bank", re: /national bank of canada|banque nationale/i, domains: ["nbc.ca", "bnc.ca"] },
    { name: "Wells Fargo", re: /wells ?fargo/i, domains: ["wellsfargo.com", "wf.com"] },
    { name: "Bank of America", re: /bank of america/i, domains: ["bankofamerica.com", "bofa.com"] },
    { name: "Chase", re: /\bjp ?morgan chase\b|\bchase bank\b/i, domains: ["chase.com", "jpmorgan.com", "jpmorganchase.com"] },
    { name: "QuickBooks", re: /quick ?books|\bintuit\b/i, domains: ["intuit.com", "quickbooks.com", "intuit.ca"] },
    { name: "Rippling", re: /\brippling\b/i, domains: ["rippling.com"] },
    { name: "Interac", re: /\binterac\b/i, domains: ["interac.ca"] },
  ];

  // Products whose sign-in a credential lure imitates for Link → O365 (incl. Google).
  const O365_LURE = /microsoft|office ?365|\bm365\b|outlook|sharepoint|onedrive|\bteams\b|exchange|webmail|mailbox|google|gmail|docusign|adobe|dropbox|storage|held (incoming )?(messages|e-?mails)/i;

  // Platforms that send on behalf of an organiser (webinars, events, surveys, CRM):
  // a Reply-To to the organiser's own domain is how they work.
  const SEND_PLATFORMS = ["gotowebinar.com", "goto.com", "swoogo.com", "eventbrite.com", "zoom.us", "cvent.com", "on24.com", "constantcontact.com", "mailchimp.com", "mcsv.net", "hubspot.com", "hubspotemail.net", "salesforce.com", "exacttarget.com", "sendgrid.net", "surveymonkey.com", "typeform.com", "docusign.net", "calendly.com", "webex.com", "eventbriteemail.com"];

  // Social profile links in signatures: never the action of an email.
  const SOCIAL_HOSTS = ["facebook.com", "twitter.com", "x.com", "youtube.com", "linkedin.com", "instagram.com", "tiktok.com", "pinterest.com", "threads.net", "wa.me"];

  // Display names that read like a system notification rather than a person or company.
  const NOTIFICATION_NAME = /^\W*\(\d+\)\s*\w|\b(held|quarantined?|pending|blocked) (messages?|e-?mails?)\b|\btasks?[-\s]?list\b|\bvoice ?mail\b|\bmail(box)? (admin|support|team|server)\b|\bstorage\b|\bit (support|desk|department)\b|\bhelp ?desk\b/i;

  // Hosts whose links are the user's own security tooling or plain infrastructure;
  // never treated as an action destination.
  const DEFENSIVE_HOSTS = ["safelinks.protection.outlook.com", "urldefense.com", "urldefense.proofpoint.com", "linkprotect.cudasvc.com", "aka.ms"];

  const SHORTENERS = ["bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "qrco.de", "v.gd", "shorte.st", "adf.ly", "lnkd.in", "bl.ink", "short.io"];

  // Free hosting and services often abused for phishing landings.
  const FREE_HOSTING = ["pages.dev", "workers.dev", "r2.dev", "web.app", "firebaseapp.com", "firebasestorage.googleapis.com", "glitch.me", "vercel.app", "netlify.app", "herokuapp.com", "github.io", "ngrok.io", "ngrok-free.app", "ngrok.app", "ipfs.io", "dweb.link", "blob.core.windows.net", "azurewebsites.net", "wixsite.com", "weebly.com", "webflow.io", "square.site", "godaddysites.com", "000webhostapp.com", "sites.google.com", "notion.site", "replit.dev", "repl.co", "onrender.com", "surge.sh", "framer.website", "jimdosite.com", "mystrikingly.com", "carrd.co", "forms.gle", "typeform.com", "jotform.com", "s3.amazonaws.com", "storage.googleapis.com", "digitaloceanspaces.com", "trycloudflare.com"];

  // Click-tracking hosts of email platforms (links are rewritten through them).
  const ESP_TRACKING = ["yamm-track.appspot.com", "go.swoogo.com", "list-manage.com", "mailchi.mp", "sendgrid.net", "mandrillapp.com", "hubspotlinks.com", "hubspotemail.net", "rs6.net", "mailgun.org", "sparkpostmail.com", "mlsend.com", "mjt.lu", "createsend.com", "cmail19.com", "cmail20.com", "awstrack.me", "klclick.com", "klclick1.com", "klclick2.com", "klclick3.com", "exct.net", "acemlna.com", "acemlnb.com", "acemlnc.com", "acemlnd.com", "sendibt2.com", "sendibt3.com", "mailjet.com", "emarsys.net", "salesforce.com", "pardot.com", "mktoweb.com", "zcsend.net", "icptrack.com"];

  const UNSUBSCRIBE = /unsubscribe|opt[\s-]?out|darse de baja|dar de baja|cancelar (la )?suscripci|désabonner|désinscri|se désinscrire|descadastr|cancelar inscri|abmelden|abbestellen|disiscriv|annulla iscrizione|uitschrijven|afmelden|preferenc|privacy|privacidad|privacidade|datenschutz|confidentialit|view (it )?in (your )?browser|ver en (el )?navegador|im browser (an)?zeigen|visualizza nel browser/i;

  const EXEC_TITLES = /\b(ceo|cfo|coo|cto|chief executive|president|presidente|presidenta|président|präsident|chairman|chairwoman|managing director|director general|directora general|directeur général|diretor(a)? (geral|executivo)|geschäftsführer|vorstand|amministratore delegato|gerente general|executive director|founder|fundador|fondateur|gründer|owner|dueño|rector|dean)\b/i;

  // Phrases per route. English, Spanish, French, Portuguese, German, Italian and Dutch;
  // other languages are flagged by script/language detection instead (signals.js).
  // Each entry: [regex, label shown in the panel].
  const PHRASES = {
    o365: [
      [/held (incoming )?(messages|e-?mails)|messages? (on hold|held for you)|storage (space )?(is )?(full|running low|almost full)|manage storage|mailbox (storage )?(is )?(full|almost full)|e-?mails? (are|were) (on hold|pending delivery)/i, "Mailbox storage / held messages"],
      [/(pending|upcoming|outstanding) tasks?|tasks? (pending|awaiting) (your )?(approval|action)|action required:|requires your (approval|action)|payroll run.{0,40}(not (yet )?approved|approval)/i, "Pending tasks / action required"],
      [/\btender (documents?|submission|invitation)|bid submission|request for (tender|proposal)|\bRFP\b|invitation to (tender|bid)|solicitation and bid/i, "Tender / bid documents"],
      [/annual leave|vacation (request|schedule|approval|list)|leave (request|application|status)|holiday (schedule|approval)/i, "Leave / vacation request"],
      [/\bW-?9\b|tax form (needed|required)|remittance (statement|advice)/i, "W-9 / remittance statement"],
      [/(secure|encrypted|protected) e-?mail|web delivery|click (here )?to (open|read|view)( (the|your))? (secure )?(message|document|e-?mail)|log ?in using your e-?mail/i, "Secure email portal"],
      [/project bid|bid (proposal|invitation)|invitaci[oó]n a (licitar|cotizar)|appel d'offres|convite para (licita|cota)|ausschreibung|gara d'appalto|aanbesteding/i, "Project Bid"],
      [/\bsalary\b|salario|\bsueldo\b|ajuste salarial|salaire|sal[aá]rio|gehalt|stipendio|salaris/i, "Salary"],
      [/payroll|n[oó]mina|paie\b|bulletin de salaire|folha de pagamento|holerite|lohnabrechnung|gehaltsabrechnung|busta paga|cedolino|loonstrook/i, "Payroll"],
      [/employee benefits|benefits (enrollment|package|update)|beneficios (para )?(los )?empleados|prestaciones|avantages sociaux|benef[ií]cios (dos|para) (funcion[aá]rios|colaboradores)|mitarbeiterleistungen|benefit aziendali|personeelsvoordelen/i, "Employee Benefits"],
      [/handbook|manual del empleado|reglamento interno|manuel de l'employ|manual do (funcion[aá]rio|colaborador)|mitarbeiterhandbuch|manuale (del dipendente|aziendale)|personeelshandboek/i, "Handbook"],
      [/docusign/i, "DocuSign document"],
      [/remittance|disbursement|remesa|comprobante de pago|avis de (paiement|virement)|comprovante de pagamento|zahlungsavis|avviso di pagamento|betalingsbewijs/i, "Remittance / disbursement"],
      [/sharepoint/i, "SharePoint file"],
      [/onedrive/i, "OneDrive file shared"],
      [/review (the )?(attached )?document|revisar (el )?documento|documento para (su )?revisi[oó]n|consulter le document|revisar o documento|dokument (pr[uü]fen|ansehen)|rivedere il documento|document (bekijken|beoordelen)/i, "Review document"],
      [/(secure|secured|protected|encrypted) (message|document|file)|mensaje (seguro|protegido|cifrado)|message (s[eé]curis[eé]|chiffr[eé]|prot[eé]g[eé])|mensagem (segura|protegida|criptografada)|(sichere|verschl[uü]sselte) nachricht|messaggio (sicuro|protetto|crittografato)|(beveiligd|versleuteld) bericht/i, "Secure / protected message"],
      [/shared (a |the )?(file|doc[uv]ment|folder)( with you)?|ha compartido (un |el )?(archivo|documento)|compartió (un |el )?(archivo|documento)|a partag[eé] (un |le )?(fichier|document)|compartilhou (um |o )?(arquivo|documento)|hat (eine datei|ein dokument) (mit ihnen )?geteilt|ha condiviso (un |il )?(file|documento)|heeft (een bestand|een document) (met u )?gedeeld/i, "Shared file"],
      [/verify (your )?(account|email|identity|mailbox)|verifica(r)? (su |tu )?(cuenta|correo|identidad)|confirm (your )?(account|credentials)|v[eé]rifie[rz]? (votre )?(compte|identit[eé])|verifi(car|que) (sua |a )?(conta|identidade)|(konto|identit[aä]t) (best[aä]tigen|verifizieren)|verifica(re)? (il tuo |il )?account|(account|identiteit) (verifi[eë]ren|bevestigen)/i, "Verify account"],
      [/password (expire|expiration|reset|will expire)|contraseña (caduca|expira|vence)|mot de passe (expire|expir[eé])|senha (expira|vai expirar)|passwort (l[aä]uft ab|abgelaufen)|password (scade|scaduta)|wachtwoord (verloopt|verlopen)|mailbox (is )?(full|storage|quota)|buz[oó]n (lleno|almacenamiento)|bo[iî]te (aux lettres )?pleine|caixa (de correio )?cheia|postfach (ist )?voll|casella (di posta )?piena|mailbox (is )?vol/i, "Password / mailbox"],
      [/sign in to (view|access|open)|log ?in to (view|access|open)|inicia(r)? sesi[oó]n para (ver|acceder|abrir)|connectez-vous pour (voir|acc[eé]der)|fa[cç]a login para (ver|acessar)|melden sie sich an,? um|accedi per (visualizzare|vedere)|log in om (te bekijken|te openen)/i, "Sign in to view"],
    ],
    bec: [
      [/#?\b(main|best|direct|personal|cell|mobile)\s*#?\s*(cell|number|phone|no\.?)?\s*(to|where i can) reach you|#cell\b|\b(your|ur) (cell|mobile|whatsapp|phone) (number|#|no\.?)|text me (at|on)|reach you (on|at|by) (your )?(cell|mobile|whatsapp)/i, "Asks for a mobile number"],
      [/\binterac\b|e-?transfer|virement interac|question de s[eé]curit[eé]|security question|zelle\b|payment (to|by) (the )?following (e-?mail|account)/i, "Payment instructions (e-transfer)"],
      [/(update|change|new|updated) (my |our |the )?(bank(ing)?|account|direct deposit|payment) (details|information|info|account)|cambi(o|ar) (de |la |mi )?(cuenta|datos) bancari|changement de (coordonn[eé]es|compte) bancaire|nouveau rib|alterar (os )?dados banc[aá]rios|mudan[cç]a de conta banc[aá]ria|(neue|ge[aä]nderte) bankverbindung|kontoverbindung [aä]ndern|nuove coordinate bancarie|cambio (di )?iban|nieuwe bankgegevens|rekeningnummer (gewijzigd|wijzigen)/i, "Bank details change"],
      [/direct deposit|dep[oó]sito directo|dep[oó]sito direto|virement de salaire/i, "Direct deposit"],
      [/payroll (department|email|team)|forward (it |this )?to payroll|reenviar a n[oó]mina|transmettre (au service )?paie|encaminhar (para )?(o )?rh/i, "Invoice / payroll"],
      [/gift ?cards?|tarjetas? de regalo|cartes? cadeaux?|cart[aã]o(-| )presente|cart[oõ]es de presente|geschenkkarten?|gutscheinkarten?|carte regalo|buoni regalo|cadeaukaarten?/i, "Gift cards"],
      [/wire (transfer|payment)|urgent (payment|transfer)|transferencia urgente|pago urgente|virement urgent|paiement urgent|transfer[eê]ncia urgente|pagamento urgente|dringende [uü]berweisung|eil[uü]berweisung|bonifico urgente|dringende (betaling|overboeking)/i, "Urgent transfer"],
      [/(send|share|give) me your (cell|mobile|phone|whatsapp|personal) (number|phone)|(m[aá]ndame|env[ií]ame|p[aá]same) tu (n[uú]mero|celular|m[oó]vil|whatsapp)|active phone number|envoyez-moi votre (num[eé]ro|portable)|me (envie|passe) seu (n[uú]mero|celular|whatsapp)|schicken sie mir ihre (handynummer|nummer)|mandami il tuo (numero|cellulare)|stuur me je (nummer|mobiele)/i, "Asks for a mobile number"],
      [/are you (at|on) your desk|are you available (now|right now)|est[aá]s disponible (ahora)?|est[aá]s en (tu|la) oficina|[eê]tes-vous disponible|voc[eê] est[aá] dispon[ií]vel|sind sie (gerade )?verf[uü]gbar|sei disponibile|ben je (nu )?beschikbaar/i, "“Are you available now?”"],
      [/(request|need|send) (a |for a )?(quote|quotation)|request for quot|\bRFQ\b|cotizaci[oó]n|demande de (devis|prix)|solicita[cç][aã]o de (cota[cç][aã]o|or[cç]amento)|angebotsanfrage|richiesta di (preventivo|offerta)|offerteaanvraag/i, "Quotation request"],
      [/keep (this|it) (confidential|between us)|confidencial(mente)? entre nosotros|reste[rz]? confidentiel|mantenha (isso )?em sigilo|bleibt unter uns|resti tra noi|blijft tussen ons/i, "Confidentiality"],
    ],
    recon: [
      [/family[\s-]office|philanthrop(y|ies|ic) (funders?|partners?|contacts?)|mission-aligned donations?/i, "Family office / philanthropic funders"],
      [/worth (discussing|a (quick )?(chat|call)|exploring)|open to (a )?(brief|quick|short) (discussion|chat|call)|wanted to (get|reach) (in touch|out)|let me know if you(?:'re| are) open to/i, "Open-ended request to talk"],
      [/(custom )?(web|mobile)( and (web|mobile))? (app(lication)?s?|development)|senior developers|engineering team|product builds?|dedicated developers|offshore (team|developers)/i, "Software development outsourcing"],
      [/can (i|we) (talk|communicate|chat) (via|by|through|over) (e-?mail|mail)|est-il possible de communiquer par (courriel|e-?mail)|podemos hablar por (correo|email)|podemos (falar|conversar) por e-?mail|k[oö]nnen wir per e-?mail|possiamo (parlare|comunicare) via e-?mail|kunnen we (via|per) e-?mail/i, "“Can we talk by email?”"],
      [/did you (get|receive|see) my (previous |last |earlier )?(e-?mail|message)|recibiste mi (correo|mensaje)|as-tu re[cç]u mon|avez-vous re[cç]u mon|voc[eê] recebeu (o )?meu|haben sie meine (e-?mail|nachricht) erhalten|hai ricevuto (la )?mia|heb je mijn (e-?mail|bericht) ontvangen/i, "“Did you get my email?”"],
      [/(this is|here is) my new (e-?mail|address)|este es mi nuevo (correo|email)|voici ma nouvelle adresse|este [eé] (o )?meu novo e-?mail|das ist meine neue (e-?mail|adresse)|questa [eè] la mia nuova (e-?mail|email)|dit is mijn nieuwe (e-?mail|adres)/i, "“My new email”"],
      [/\b(let'?s|lets) connect\b|are you available\b|quick (chat|call|question)|est[aá]s disponible|[eê]tes-vous disponible|est[aá] dispon[ií]vel|sind sie verf[uü]gbar|sei disponibile|ben je beschikbaar/i, "Availability probe"],
      [/\b1[05] ?(-| )?min(ute|uto|utos|uten|uti)?s?\b.*\b(call|meeting|chat|zoom|teams|llamada|reuni[oó]n|r[eé]union|chamada|reuni[aã]o|anruf|treffen|chiamata|riunione|gesprek)\b|\b(call|meeting|chat|zoom|teams)\b.*\b1[05] ?(-| )?min/i, "Short meeting with no stated purpose"],
      [/virtual assistan|asistente virtual|assistant(e)? virtuel|assistente virtual|virtuelle(r)? assistent|assistente virtuale|virtuele assistent/i, "Virtual assistant"],
      [/\bseo\b|google (rank|ranking|first page)|primera p[aá]gina de google|premi[eè]re page de google|primeira p[aá]gina do google|erste seite (bei|von) google|prima pagina di google|eerste pagina van google|website (errors|issues)|errores en (su|tu) (sitio|web)|erreurs sur votre site|erros no (seu )?site|fehler auf ihrer (website|webseite)|errori sul (tuo|vostro) sito|fouten op uw website/i, "SEO / website errors"],
      [/(web|website|mobile|app) (design|development|developer)|desarrollo (web|de apps|de aplicaciones)|d[eé]veloppement (web|d'applications)|desenvolvimento (web|de aplicativos)|(web|app)entwicklung|sviluppo (web|app)|(web|app)ontwikkeling/i, "Web / app development"],
      [/domain (name )?(for sale|available)|selling (the )?domain|venta de dominio|nom de domaine [aà] vendre|dom[ií]nio [aà] venda|domain zu verkaufen|dominio in vendita|domein te koop/i, "Domain for sale"],
      [/attendee(s)? (list|data)|lista de (asistentes|participantes)|liste des (participants|inscrits)|teilnehmerliste|lista (dei )?partecipanti|deelnemerslijst|(contact|email|b2b) (list|database)|base de datos de (contactos|clientes)|base de donn[eé]es (clients|contacts)|base de dados de (contatos|clientes)|kontaktdatenbank|database (di )?contatti/i, "Attendee list / database"],
      [/bookkeep|recruit(er|ing) services|contable externo|services de (recrutement|comptabilit)|servi[cç]os de (recrutamento|contabilidade)|buchhaltungs(service|dienst)|servizi di (contabilit|reclutamento)|boekhoud(diensten|service)/i, "Bookkeeping / recruiters"],
      [/(cost|cleaning|price) estimat|presupuesto de limpieza|devis (de nettoyage|gratuit)|or[cç]amento (de limpeza|gratuito)|kostenvoranschlag|preventivo (di pulizia|gratuito)|offerte (voor schoonmaak|gratis)/i, "Cost estimate"],
      [/line of credit|\bLOC\b|l[ií]nea de cr[eé]dito|ligne de cr[eé]dit|linha de cr[eé]dito|kreditlinie|linea di credito|kredietlijn|family office/i, "Line of credit / family office"],
    ],
    scam419: [
      [/(\$|usd|us\$|eur|€|£)\s?\d{1,3}(,\d{3}){2,}|\d{1,3}(,\d{3}){2,}(\.\d+)?\s?(usd|dollars|euros?|eur)\b/i, "Sum in the millions written out"],
      [/(compensation|composition|inheritance|beneficiary|consignment|unclaimed) fund|united nations?\b.{0,60}(fund|approved|release)|\batm (visa |master ?)?card\b|claim (your|the) (fund|payment|prize)|fund (has been )?(approved|released|deposited)/i, "Fund / ATM card release"],
      [/(collections?|account resolution|recovery) department|outstanding (loan )?balance|settlement amount|payment arrangement|unresolved (loan|debt|balance)|debt collector|escalated for (further )?recovery/i, "Debt collection"],
      [/raising \$?\s?\d+(\.\d+)?\s?(m|mm|million|k)\b|interested in seeing (our|the) (deck|pitch)|investor deck/i, "Fund-raising pitch"],
      [/inheritance|next of kin|beneficiar(y|io)|herencia|h[eé]ritage|testament|heran[cç]a|erbschaft|nachlass|eredit[aà]|erfenis/i, "Inheritance / beneficiary"],
      [/(\$|usd|us\$|eur|€|£)\s?\d[\d,.]*\s?(million|m\b|millones|millions|milh[oõ]es|millionen|milioni|miljoen)|\d[\d,.]*\s?(million|millones|millions|milh[oõ]es|millionen|milioni|miljoen) (dollars|usd|euros?|de d[oó]lares|de d[oó]lares|dollari|dollar)/i, "Multi-million sum"],
      [/donat(e|ion)|grand piano|piano de cola|donaci[oó]n|don de|doa[cç][aã]o|spende|donazione|donatie/i, "Donation / piano"],
      [/\bloan\b.{0,40}\b[0-4](\.\d+)? ?%|pr[eé]stamo.{0,40}\b[0-4](,\d+)? ?%|pr[eê]t.{0,40}\b[0-4](,\d+)? ?%|empr[eé]stimo.{0,40}\b[0-4](,\d+)? ?%|kredit.{0,40}\b[0-4](,\d+)? ?%|prestito.{0,40}\b[0-4](,\d+)? ?%|lening.{0,40}\b[0-4](,\d+)? ?%|\b[0-4](\.\d+)? ?% (interest|inter[eé]s|int[eé]r[eê]t|juros|zinsen|interesse|rente)/i, "Loan under 5% interest"],
      [/can i ask (you )?(for )?a favou?r|puedo pedirte un favor|puis-je vous demander un service|posso (te )?pedir um favor|darf ich sie um einen gefallen bitten|posso chiederti un favore|mag ik je een gunst vragen/i, "“Can I ask a favor?”"],
      [/do you shop (on|at|in) amazon|compras en amazon|achetez-vous sur amazon|voc[eê] compra na amazon|kaufen sie bei amazon|compri su amazon|koop je bij amazon/i, "“Do you shop on Amazon?”"],
      [/\bloyer\b/i, "Loyer (rent)"],
      [/(crude )?oil (supplier|provider|company)|petr[oó]leo|p[eé]trole brut|roh[oö]l|petrolio greggio|ruwe olie/i, "Oil supplier"],
      [/lottery|loter[ií]a|you (have )?won|has ganado|vous avez gagn|voc[eê] ganhou|sie haben gewonnen|hai vinto|u heeft gewonnen|compensation fund|fondo de compensaci|fonds de compensation|fundo de compensa[cç][aã]o/i, "Prize / compensation"],
      [/investment (opportunity|proposal)|oportunidad de inversi[oó]n|opportunit[eé] d'investissement|oportunidade de investimento|investitionsm[oö]glichkeit|opportunit[aà] di investimento|investeringsmogelijkheid|(roi|return|rendimiento|retorno|rendement|rendite)s? (of |de )?(\d{2,3}|\d{1,3},\d)\s?%|\b\d{2,3}\s?% (roi|return|annual|mensual|anual|annuel|mensuel|j[aä]hrlich|annuo)/i, "Investment with outsized return"],
      [/subpoena|citaci[oó]n judicial|citation (à comparaître|judiciaire)|intima[cç][aã]o judicial|vorladung|citazione in giudizio|dagvaarding|p[eé]dophil|cyberp.?rn/i, "Fake legal summons"],
      [/alumni|alumnus|ex ?alumno|exalumn|ancien [eé]l[eè]ve|ex-aluno|ehemalige(r)? (student|kommiliton)|ex studente|oud-student/i, "Claimed alumnus"],
      [/(buy|purchase|order) (an |some )?insurance|comprar (un )?seguro|souscrire une assurance|contratar (um )?seguro|versicherung abschlie[sß]en|stipulare un'assicurazione|verzekering afsluiten/i, "Insurance purchase"],
    ],
    vishing: [
      [/invoice|receipt|order (confirmation|number|#)|subscription|renewal|auto[- ]?renew|charged|factura|recibo|suscripci[oó]n|renovaci[oó]n|cargo de|facture|abonnement|renouvellement|fatura|assinatura|renova[cç][aã]o|rechnung|verl[aä]ngerung|fattura|abbonamento|rinnovo|factuur|verlenging/i, "Invoice / renewal"],
      [/(call|contact|reach) (us|our (support|billing|team)|the number|now|immediately)|llam(e|a|ar) (al|a nuestro|ahora|inmediatamente)|cont[aá]ct(e|enos) al|appelez(-nous)? (le|au|maintenant)|ligue (para|agora)|rufen sie (uns )?(an|unter)|chiama(teci)? (il|al|ora)|bel (ons|naar|nu)/i, "Asks to call"],
      [/(did not|didn'?t) (authorize|make|recognize) (this|the)|no (reconoce|autoriz[oó])|cancel (this|the) (order|transaction|subscription)|cancelar (el|este) (pedido|cargo|cobro)|vous n'avez pas autoris|annuler (la|cette) (commande|transaction)|n[aã]o (reconhece|autorizou)|nicht autorisiert|stornieren|non (hai|ha) autorizzato|annullare (l'ordine|la transazione)|niet geautoriseerd|annuleren/i, "Cancel an unrecognised charge"],
    ],
    vishingBrands: /paypal|geek ?squad|norton|mcafee|microsoft|apple|amazon|best ?buy|quick ?books|intuit|coinbase|avast|kaspersky|bitdefender|windows defender/i,
    job: [
      [/(we are|we're) hiring|job (offer|opportunity|position)|remote (job|position|work)|work from home|part[- ]time (job|position)|oferta de (empleo|trabajo)|trabajo (remoto|desde casa)|vacante|offre d'emploi|t[eé]l[eé]travail|vaga de emprego|trabalho (remoto|em casa)|stellenangebot|homeoffice|offerta di lavoro|lavoro da casa|vacature|thuiswerk/i, "Job offer"],
      [/\$\s?\d{2,4} ?(per|\/|a) ?(hour|week|day)|\d{2,4} ?(usd|d[oó]lares|euros?|€) (por|a la|par|pro|all'|per) (hora|semana|d[ií]a|heure|semaine|jour|stunde|woche|tag|ora|settimana|giorno|uur|week|dag)|weekly pay/i, "Hourly / weekly pay"],
      [/(send|share|provide) (your|us your) (resume|cv|ssn|social security|id|passport|bank)|env[ií](e|a)nos (su|tu) (cv|curr[ií]culum|identificaci[oó]n)|envoyez(-nous)? votre (cv|pi[eè]ce d'identit[eé])|envie (seu|o seu) (curr[ií]culo|cv|documento)|senden sie (uns )?ihren (lebenslauf|ausweis)|inviaci il tuo (cv|curriculum|documento)|stuur (ons )?je (cv|identiteitsbewijs)/i, "Asks for CV / documents"],
    ],
    techsupport: [
      [/anydesk|teamviewer|ultraviewer|supremo|logmein|connectwise|screenconnect|remote (desktop|access|support)|acceso remoto|soporte remoto|acc[eè]s [aà] distance|acesso remoto|fernzugriff|fernwartung|accesso remoto|toegang op afstand/i, "Remote access"],
      [/(your )?(computer|pc|device|system) (is|has been) (infected|compromised|hacked|locked)|virus (detected|found)|(equipo|computadora|ordenador) (infectad|bloquead)|ordinateur (infect|bloqu)|computador (infectad|bloquead)|computer (ist )?(infiziert|gesperrt)|computer (infetto|bloccato)|computer (is )?(ge[iï]nfecteerd|geblokkeerd)/i, "Infected / locked device"],
    ],
    phishing: [
      [/(survey|encuesta|questionnaire|sondage|pesquisa|umfrage|sondaggio|enqu[eê]te).{0,80}(free|reward|gift|gratis|regalo|premio|gratuit|cadeau|gr[aá]tis|presente|geschenk|kostenlos|omaggio|cadeau)|(free|reward|gift|gratis|regalo|premio|cadeau|presente|geschenk).{0,80}(survey|encuesta|sondage|pesquisa|umfrage|sondaggio)/i, "Survey with a gift"],
      [/free spins|giros gratis|tours gratuits|rodadas gr[aá]tis|freispiele|giri gratis|gratis spins|casino|jackpot|bonus de bienvenida|bonus de bienvenue/i, "Casino / free spins"],
      [/connect (your )?wallet|seed phrase|recovery phrase|frase (semilla|de recuperaci[oó]n)|conecta(r)? (tu|su) (billetera|wallet)|phrase de r[eé]cup[eé]ration|connectez votre portefeuille|frase de recupera[cç][aã]o|conecte sua carteira|wallet verbinden|seed-phrase|collega il (tuo )?wallet|herstelzin/i, "Connect wallet"],
      [/google partner(ship)?/i, "Google Partnership"],
      [/(pics|photos|photographs|memories|fotos|recuerdos|souvenirs|lembran[cç]as|erinnerungen|ricordi|herinneringen)\b/i, "Photos / memories"],
    ],
    dating: /\b(dating|singles?|lonely|hot (girls|women)|meet (?:(?:beautiful|single|ukrainian|russian|asian|latin|lonely|hot|sexy) )*(girls|women|ladies)|date tonight|romance|citas|solteras?|ligar|rencontres?|c[eé]libataires?|namoro|solteiras?|partnersuche|single(b[oö]rse|s)|incontri|appuntamenti|charmdate|sexy)\b/i,
    attachmentMention: /\b(attached|attachment|see (the )?attach|find (the )?enclosed|enclosed (please )?find|adjunto|archivo adjunto|ver adjunto|pi[eè]ce jointe|ci-joint|em anexo|segue anexo|anexo|im anhang|anbei|in allegato|allegato|in de bijlage|bijgevoegd)\b/i,
    forwardedBlock: /-{2,}\s*(forwarded message|original message|mensaje (original|reenviado)|message (d'origine|transf[eé]r[eé])|mensagem (original|encaminhada)|weitergeleitete nachricht|urspr[uü]ngliche nachricht|messaggio (originale|inoltrato)|doorgestuurd bericht|oorspronkelijk bericht)\s*-{2,}|^(from|de|von|da|van):.*\n(sent|enviado|date|fecha|envoy[eé]|gesendet|inviato|verzonden|data|datum):/im,
    reportNarrative: /\b(customer|client(e)?|cliente|kunde|klant|member|cx) (received|got|recibi[oó]|recibió|a re[cç]u|recebeu|erhielt|ha ricevuto|ontving) (a |an |una |un |um |uma |einen |eine |een )?(phone |text )?(call|llamada|appel|liga[cç][aã]o|anruf|chiamata|telefoontje|sms|text message|email|correo|e-?mail)|reporting (a |this )?(fraud|incident|case)|reportar (un |este )?(fraude|incidente|caso)|signaler (une |cette )?(fraude|incident)|reportar (uma |esta )?(fraude)|melden (einen )?(betrug|vorfall)|segnalare (una )?(frode|truffa)|melden van (een )?(fraude|incident)|fue (estafad|defraudad)|was (scammed|defrauded)|\bcall(ed)? (was )?received\b|\b(received|got) a (phone )?call\b|\bcall from \+?\(?\d|\btold (the )?(cx|customer|client|member)\b|\b(cx|customer|client|member) (did ?n[o']t|didn’t|never) (confirm|give|share|provide|click)|\bfraudster|\bscammer|\bbrought (this|it) to my attention|\bforward (this|it) to (fraud|security)|appel (re[çc]u|frauduleux)|a re[çc]u un appel|llamada (recibida|fraudulenta)|recibi[óo] una llamada/i,
    // An older message quoted on one line ("De: X Enviado: … Para: … Asunto: …").
    inlineHeader: /\b(from|de|von|da|van):\s.{1,100}?\b(sent|enviado|envoy[eé]|date|gesendet|fecha|inviato|verzonden):\s.{1,80}?\b(to|para|[aà]|an|aan):\s.{1,160}?\b(subject|asunto|objet|betreff|assunto|oggetto|onderwerp):/i,
    // "On <date>, <name> wrote:" and its translations.
    replyLine: /^.{0,200}\b(wrote|a [eé]crit|escribi[oó]|escreveu|schrieb|ha scritto|schreef)\s*:\s*$/im,
    // Lines of a personal-details form ("Your-Full Name:", "Date of birth:").
    piiField: /^\s*(your[-\s]*)?(full\s*name|name|home address|address|phone( number)?|mobile( number)?|cell( number)?|whats\s?app( number)?|fax( mobile)?( number)?|country|city|state( of origin)?|nationality|occupation|age|sex|gender|birthday|date of birth|next of kin[^:\n]*|marital status|id( card)?|passport)[^:\n]{0,25}:\s*$/gim,
    // Promised returns ("441 % ROI", "return of 300%").
    roi: /(\d{2,4}(?:[.,]\d+)?)\s?%\s?(?:roi|return|annual (?:return|yield)|yield|profit)|(?:roi|return|rendement|rendimiento|retorno)\s(?:of|de)\s(\d{2,4})\s?%/i,
    // Random token strings that defeat spam fingerprints ("YgNG|ROVMZ|y0dr|s6xy…").
    hashBuster: /(?:\b[A-Za-z0-9]{3,12}\|){4,}[A-Za-z0-9]{3,12}\b/,
    // Reference numbers bolted onto a subject ("| ID:733-LX-610", "[Ref: 339JYXQM]").
    subjectRef: /(\||\[|\(|-)\s*(id|ref|reference|case|ticket|ref!)\s*[:#!.]?\s*[A-Z0-9]{2,}[-A-Z0-9]{3,}\]?|\bREF!\s*\d{6,}/i,
    // Introducing oneself by name in the text.
    selfIntro: /\b(?:[Ii]['’]?m|[Ii] am|[Mm]y name is|[Tt]his is|[Jj]e m'appelle|[Jj]e suis|[Mm]e llamo|[Mm]i nombre es|[Ss]oy|[Mm]eu nome [eé])\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/,
    // Greeting followed by one token ("Dear jane.doe,").
    greeting: /^\s*(?:dear|hi|hello|hey|hola|estimad[oa]|bonjour|ol[aá]|hallo|ciao|beste|good (?:morning|afternoon))\s+([^\s,!:]+)/im,
    // Where the body asks to write, reply or pay to an address.
    contactContext: /(contact|write (to|at)|reply (to|at)|send (it|them|your|the|us)? ?(to|at)|e-?mail\s*:|email (him|her|us|me)|e-?mail address|courriel|correo|adresse|reach (me|us|him|her)|get in touch|interac|e-?transfer|paiement|pago|virement|pay (to|by|via))/i,
    paymentContext: /(interac|e-?transfer|virement|zelle|\bpay (to|by|via)\b|paiement|pago|payment (to|by|via|method|address|details)|remit(tance)? to)/i,
    // A forwarded message that is itself someone reporting what they received.
    reportSubject: /\b(possible|potential|suspected|suspicious|probable)\s+(spam|scam|fraud|phish(ing)?)\b|\bis this (legit(imate)?|real|you|a scam|phishing)\b|\b(spam|scam|fraud|phishing) (at|from|using|claiming|pretending)\b|\bposible (fraude|estafa|spam)|\b(fraude|arnaque|hame[çc]onnage) possible/i,
    // Bank details that make forwarded payment instructions (counted per distinct term).
    paymentDetails: /\b(swift(\/bic)?|bic|iban|aba|routing number|account number|n[uú]mero de cuenta|datos bancarios|coordonn[eé]es bancaires|bank(ing)? details|wire transfer|transferencia internacional|international wire|mt103|beneficiary bank|banco beneficiario|banco intermediario|intermediary bank|interac|e-?transfer|virement)\b/gi,
    // The email gives the password of its attachment.
    passwordHint: /(password|passcode|pass code|mot de passe|contrase[ñn]a|clave|senha|passwort|kennwort|wachtwoord|code)\b[^.\n]{0,80}|(e-?mail|courriel|correo)[^.\n]{0,60}(password|mot de passe|contrase[ñn]a|senha)/i,
    // Call to action written in a lure PDF.
    fileCta: /\b(view|open|access|review|download|read|sign( in)?|log ?in|click|check|verify|confirm)\b[^\n]{0,40}\b(message|document|file|invoice|payment|status|bid|proposal|statement|request|account|here|now|securely)\b|\b(view|open|download) (bid|status|document|file|pdf|message|invoice)\b|\bclick (here|to read)\b|\b(ver|abrir|descargar|consulter|ouvrir|t[eé]l[eé]charger|afficher) (el |le |la |o )?(documento|document|archivo|fichier|mensaje|message)\b/i,
  };

  // External-mail banners and gateway notices (one line each), stripped before word
  // counts, language detection and phrase matching.
  const BANNER = /(you don.?t often get (e-?mail|messages) from|vous n.?obtenez pas souvent|no suele recibir correos|learn why this is important|pourquoi c.?est important|por qu[eé] esto es importante|originated (from )?outside (of )?(your|the|this)\b|from an? (external|outside) source|source outside of|externe?\/external|external\/externe|courriel externe|ce courriel provient de l.?externe|provient d.?une source externe|correo externo|external (e-?mail|mail|sender)\b.{0,40}(caution|click|link|attachment|trust|warning|vigilant)|(caution|warning|attention|prudence)\b.{0,60}external|do not click (on )?links|ne cliquez pas|think before clicking|be cautious when (opening|clicking)|unless you recognize the sender|report (it )?using the [“"]?report|report phish button|security advisory: this email|do not disclose any confidential|ne divulguez aucune|soyez vigilant|be vigilant, develop|n.?ouvrez pas de pi[eè]ces jointes)/i;
  // Legal footers ("This e-mail ... is confidential ... if received in error").
  const DISCLAIMER = /(confidential|privileged|confidentiel|confidencial)\b.{0,300}(intended (solely )?(for|recipient)|received (it |this )?(e-?mail |message )?(in|by) error|re[cç]u par erreur|recibido por error|unauthori[sz]ed (use|copying|disclosure))|stop receiving commercial electronic messages|se d[eé]sabonner des messages [eé]lectroniques|consider the environment before printing/i;

  // Lines where a phone number is a signature or contact detail, not a call to action.
  const PHONE_SIGNATURE = /(^|\s)(t|tel|t[eé]l[eé]?|telec|phone|ph|m|mob|mobile|cell#?|c|f|fax|t[eé]l[eé]copieur|ext|poste|direct|office|o|main)\s*[.:#]|\bext\.?\s*\d|\bfax\b|\bposte\s*\d/i;
  // Words that turn a nearby phone number into the lure's callback number.
  const PHONE_CTA = /\b(call|calling|toll[\s-]?free|dial|helpline|hotline|customer (service|care|support)|support (team|line|desk)|billing (team|department|support)|reach (us|our)|contact (us|our)|llam(e|a|ar|enos)|appel(ez|er)|ligue|anrufen|rufen sie|chiama|bel ons)\b/i;

  // Weak technical signals that still make a message suspicious (for the DNE hypothesis).
  const SUSPICIOUS_WEAK = /^(Freemail|Authentication failures|Display name|Random-looking|Undisclosed|No To header|Sender header|To shows|Text hidden|Language:|Randomly named|Reference number|Follows up on its own|Asks to write|Old conversation|Link (made only|to an IP|bounces)|IDN|URL shortener|Free hosting|Link on a TLD)/;

  // Traces phishing-simulation platforms leave in Message-IDs and tracking pixels. These
  // only suggest an exercise; Simulation needs the domain attributed to the vendor from a
  // current source (guide, step 8). Verified domains go in the popup's settings.
  const SIMULATION_MARKERS = [
    { re: /<threatsim-[^@>]*@/i, label: "Message-ID in the format of the ThreatSim simulation platform" },
  ];

  // Attachment types worth a static look for Docuphish (SEA p. 15).
  const DOC_ATTACHMENT = /\.(html?|shtml|xhtml|svg|pdf|htm|mht|mhtml|txt|eml|zip|rar|7z|iso|img|one|docm|xlsm|pptm)$/i;
  const HTML_ATTACHMENT = /\.(html?|shtml|xhtml|svg|mht|mhtml)$/i;

  return {
    ROUTES, FREEMAIL, MULTI_LEVEL_SUFFIXES, BRANDS, DEFENSIVE_HOSTS, SHORTENERS, FREE_HOSTING, ESP_TRACKING, UNSUBSCRIBE,
    EXEC_TITLES, PHRASES, DOC_ATTACHMENT, HTML_ATTACHMENT, BANNER, DISCLAIMER, PHONE_SIGNATURE, PHONE_CTA,
    BRAND_WORDS, O365_LURE, SEND_PLATFORMS, SOCIAL_HOSTS, NOTIFICATION_NAME, SIMULATION_MARKERS, SUSPICIOUS_WEAK,
  };
});
