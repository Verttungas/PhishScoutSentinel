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
  };

  // Hosts whose links are the user's own security tooling or plain infrastructure;
  // never treated as an action destination.
  const DEFENSIVE_HOSTS = ["safelinks.protection.outlook.com", "urldefense.com", "urldefense.proofpoint.com", "linkprotect.cudasvc.com", "aka.ms"];

  const SHORTENERS = ["bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "qrco.de", "v.gd", "shorte.st", "adf.ly", "lnkd.in", "bl.ink", "short.io"];

  // Free hosting and services often abused for phishing landings.
  const FREE_HOSTING = ["pages.dev", "workers.dev", "r2.dev", "web.app", "firebaseapp.com", "firebasestorage.googleapis.com", "glitch.me", "vercel.app", "netlify.app", "herokuapp.com", "github.io", "ngrok.io", "ngrok-free.app", "ngrok.app", "ipfs.io", "dweb.link", "blob.core.windows.net", "azurewebsites.net", "wixsite.com", "weebly.com", "webflow.io", "square.site", "godaddysites.com", "000webhostapp.com", "sites.google.com", "notion.site", "replit.dev", "repl.co", "onrender.com", "surge.sh", "framer.website", "jimdosite.com", "mystrikingly.com", "carrd.co", "forms.gle", "typeform.com", "jotform.com", "s3.amazonaws.com", "storage.googleapis.com", "digitaloceanspaces.com", "trycloudflare.com"];

  // Click-tracking hosts of email platforms (links are rewritten through them).
  const ESP_TRACKING = ["list-manage.com", "mailchi.mp", "sendgrid.net", "mandrillapp.com", "hubspotlinks.com", "hubspotemail.net", "rs6.net", "mailgun.org", "sparkpostmail.com", "mlsend.com", "mjt.lu", "createsend.com", "cmail19.com", "cmail20.com", "awstrack.me", "klclick.com", "klclick1.com", "klclick2.com", "klclick3.com", "exct.net", "acemlna.com", "acemlnb.com", "acemlnc.com", "acemlnd.com", "sendibt2.com", "sendibt3.com", "mailjet.com", "emarsys.net", "salesforce.com", "pardot.com", "mktoweb.com", "zcsend.net", "icptrack.com"];

  const UNSUBSCRIBE = /unsubscribe|opt[\s-]?out|darse de baja|dar de baja|cancelar (la )?suscripci|désabonner|désinscri|se désinscrire|descadastr|cancelar inscri|abmelden|abbestellen|disiscriv|annulla iscrizione|uitschrijven|afmelden|preferenc|privacy|privacidad|privacidade|datenschutz|confidentialit|view (it )?in (your )?browser|ver en (el )?navegador|im browser (an)?zeigen|visualizza nel browser/i;

  const EXEC_TITLES = /\b(ceo|cfo|coo|cto|chief executive|president|presidente|presidenta|président|präsident|chairman|chairwoman|managing director|director general|directora general|directeur général|diretor(a)? (geral|executivo)|geschäftsführer|vorstand|amministratore delegato|gerente general|executive director|founder|fundador|fondateur|gründer|owner|dueño|rector|dean)\b/i;

  // Phrases per route. English, Spanish, French, Portuguese, German, Italian and Dutch;
  // other languages are flagged by script/language detection instead (signals.js).
  // Each entry: [regex, label shown in the panel].
  const PHRASES = {
    o365: [
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
      [/shared (a |the )?(file|document|folder) with you|ha compartido (un |el )?(archivo|documento)|compartió (un |el )?(archivo|documento)|a partag[eé] (un |le )?(fichier|document)|compartilhou (um |o )?(arquivo|documento)|hat (eine datei|ein dokument) (mit ihnen )?geteilt|ha condiviso (un |il )?(file|documento)|heeft (een bestand|een document) (met u )?gedeeld/i, "Shared file"],
      [/verify (your )?(account|email|identity|mailbox)|verifica(r)? (su |tu )?(cuenta|correo|identidad)|confirm (your )?(account|credentials)|v[eé]rifie[rz]? (votre )?(compte|identit[eé])|verifi(car|que) (sua |a )?(conta|identidade)|(konto|identit[aä]t) (best[aä]tigen|verifizieren)|verifica(re)? (il tuo |il )?account|(account|identiteit) (verifi[eë]ren|bevestigen)/i, "Verify account"],
      [/password (expire|expiration|reset|will expire)|contraseña (caduca|expira|vence)|mot de passe (expire|expir[eé])|senha (expira|vai expirar)|passwort (l[aä]uft ab|abgelaufen)|password (scade|scaduta)|wachtwoord (verloopt|verlopen)|mailbox (is )?(full|storage|quota)|buz[oó]n (lleno|almacenamiento)|bo[iî]te (aux lettres )?pleine|caixa (de correio )?cheia|postfach (ist )?voll|casella (di posta )?piena|mailbox (is )?vol/i, "Password / mailbox"],
      [/sign in to (view|access|open)|log ?in to (view|access|open)|inicia(r)? sesi[oó]n para (ver|acceder|abrir)|connectez-vous pour (voir|acc[eé]der)|fa[cç]a login para (ver|acessar)|melden sie sich an,? um|accedi per (visualizzare|vedere)|log in om (te bekijken|te openen)/i, "Sign in to view"],
    ],
    bec: [
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
    vishingBrands: /paypal|geek ?squad|norton|mcafee|microsoft|apple|amazon|best ?buy|coinbase|avast|kaspersky|bitdefender|windows defender/i,
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
    reportNarrative: /\b(customer|client(e)?|cliente|kunde|klant) (received|got|recibi[oó]|recibió|a re[cç]u|recebeu|erhielt|ha ricevuto|ontving) (a |una |un |um |uma |einen |eine |een )?(call|llamada|appel|liga[cç][aã]o|anruf|chiamata|telefoontje|email|correo|e-?mail)|reporting (a |this )?(fraud|incident|case)|reportar (un |este )?(fraude|incidente|caso)|signaler (une |cette )?(fraude|incident)|reportar (uma |esta )?(fraude)|melden (einen )?(betrug|vorfall)|segnalare (una )?(frode|truffa)|melden van (een )?(fraude|incident)|fue (estafad|defraudad)|was (scammed|defrauded)/i,
  };

  // Attachment types worth a static look for Docuphish (SEA p. 15).
  const DOC_ATTACHMENT = /\.(html?|shtml|xhtml|svg|pdf|htm|mht|mhtml|txt|eml|zip|rar|7z|iso|img|one|docm|xlsm|pptm)$/i;
  const HTML_ATTACHMENT = /\.(html?|shtml|xhtml|svg|mht|mhtml)$/i;

  return {
    ROUTES, FREEMAIL, MULTI_LEVEL_SUFFIXES, BRANDS, DEFENSIVE_HOSTS, SHORTENERS, FREE_HOSTING, ESP_TRACKING, UNSUBSCRIBE,
    EXEC_TITLES, PHRASES, DOC_ATTACHMENT, HTML_ATTACHMENT,
  };
});
