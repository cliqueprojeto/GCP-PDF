import { DOMParser } from '@xmldom/xmldom';
// bwip-js publishes its types only through package "exports", which this project's module resolution does not read.
const bwipjs = require('bwip-js') as { toSVG(options: Record<string, unknown>): string };
import QRCode from 'qrcode';

/** Brazilian fiscal XML (NF-e, NFC-e, NFS-e Nacional, NFS-e ABRASF/municipal, CT-e…) rendered locally as
 * the auxiliary document printed for it (DANFE, DANFE NFC-e, DANFSe…). Each format is identified
 * explicitly; anything not recognised gets a faithful field-by-field layout instead of a guess. */
export type HtmlToPdf = (html: string) => Promise<Uint8Array>;
export type FiscalKind = 'nfe' | 'nfce' | 'nfse-nacional' | 'nfse-abrasf' | 'generico';

type Node = Element | null | undefined;
const local = (n: globalThis.Node) => (n as Element).localName ?? (n as Element).nodeName.replace(/^.*:/, '');
const kids = (e: Node) => (e ? [...(e.childNodes as unknown as globalThis.Node[])].filter((c): c is Element => c.nodeType === 1) : []);
/** First descendant (depth-first) with that local name; `path` walks a/b/c. */
function find(e: Node, path: string): Element | null {
  let current: Element | null = e ?? null;
  for (const name of path.split('/')) {
    if (!current) return null;
    const stack = [...kids(current)];
    let hit: Element | null = null;
    while (stack.length) { const c = stack.shift()!; if (local(c) === name) { hit = c; break; } stack.push(...kids(c)); }
    current = hit;
  }
  return current;
}
const all = (e: Node, name: string) => { const out: Element[] = []; const walk = (x: Element) => { for (const c of kids(x)) { if (local(c) === name) out.push(c); walk(c); } }; if (e) walk(e); return out; };
const text = (e: Node, path = '') => ((path ? find(e, path) : e)?.textContent ?? '').trim();
// The XML is untrusted input: every value reaches the HTML through esc(), including the formatters'
// fall-backs that return the raw text when it does not look like a CNPJ, date, phone…
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (v: string, digits = 2) => (v === '' || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const money = (v: string) => (v === '' ? '' : 'R$ ' + num(v));
function doc(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return esc(v);
}
const cep = (v: string) => esc(v.replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2'));
const phone = (v: string) => { const d = v.replace(/\D/g, '').replace(/^0+/, ''); return d.length === 11 ? d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3') : d.length === 10 ? d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3') : esc(v); };
function date(v: string, time = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(v);
  if (!m) return esc(v);
  return `${m[3]}/${m[2]}/${m[1]}${time && m[4] ? ` ${m[4]}:${m[5]}:${m[6]}` : ''}`;
}
const chaveFmt = (k: string) => esc(k.replace(/(\d{4})(?=\d)/g, '$1 '));
const docOf = (e: Node) => doc(text(e, 'CNPJ') || text(e, 'CPF') || text(e, 'idEstrangeiro'));
const lines = (v: string) => esc(v.replace(/<br\s*\/?>/gi, '\n')).replace(/\n/g, '<br>');

async function barcode(value: string) {
  return bwipjs.toSVG({ bcid: 'code128', text: value, height: 11, includetext: false, paddingwidth: 0, paddingheight: 0 });
}
const qr = (value: string) => QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });

/** No scripts, no network, no frames: the page can only draw itself. */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
const BASE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
.box{border:1px solid #000;padding:2px 4px;min-height:24px;overflow:hidden}.l{font-size:6.2pt;text-transform:uppercase;color:#222;display:block;line-height:1.2}
.v{font-size:8.6pt;line-height:1.25;word-break:break-word}.row{display:flex}.row>.box{flex:1;border-right:none}.row>.box:last-child{border-right:1px solid #000}
.row+.row>.box,.row+.box,.box+.row>.box{border-top:none}.sec{font-size:7pt;font-weight:bold;margin:6px 0 1px;text-transform:uppercase}.r{text-align:right}.c{text-align:center}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #000;padding:1px 3px;font-size:6.8pt;vertical-align:top}th{font-size:5.8pt;font-weight:normal;text-transform:uppercase;background:#f2f2f2}
.watermark{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:48pt;color:rgba(200,0,0,.18);transform:rotate(-28deg);font-weight:bold;z-index:-1}`;

/* ---------------- NF-e (modelo 55): DANFE retrato ---------------- */
async function danfe(root: Element): Promise<string> {
  const inf = find(root, 'infNFe')!, ide = find(inf, 'ide'), emit = find(inf, 'emit'), dest = find(inf, 'dest'), tot = find(inf, 'total/ICMSTot'), transp = find(inf, 'transp');
  const prot = find(root, 'protNFe/infProt'), chave = (inf.getAttribute('Id') ?? '').replace(/^NFe/, '') || text(prot, 'chNFe');
  const nNF = text(ide, 'nNF').padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3'), serie = text(ide, 'serie').padStart(3, '0');
  const ender = (e: Node) => [text(e, 'xLgr'), text(e, 'nro'), text(e, 'xCpl')].filter(Boolean).join(', ');
  const homolog = text(ide, 'tpAmb') === '2';
  const items = all(inf, 'det').map((det) => {
    const p = find(det, 'prod'), icms = kids(find(det, 'imposto/ICMS'))[0], ipi = find(det, 'imposto/IPI');
    const di = all(p, 'DI').map((d) => `DI ${esc(text(d, 'nDI'))} de ${date(text(d, 'dDI'), false)} · Desembaraço ${esc(text(d, 'xLocDesemb'))}/${esc(text(d, 'UFDesemb'))} em ${date(text(d, 'dDesemb'), false)}${all(d, 'adi').length ? ` · Adições ${all(d, 'adi').map((a) => text(a, 'nAdicao')).join(', ')}` : ''}`).join('<br>');
    const extra = [text(det, 'infAdProd'), text(p, 'xPed') && `Pedido ${text(p, 'xPed')}`].filter(Boolean).map(esc).join(' · ');
    return `<tr><td>${esc(text(p, 'cProd'))}</td><td>${esc(text(p, 'xProd'))}${di ? `<br><i>${di}</i>` : ''}${extra ? `<br><i>${extra}</i>` : ''}</td><td>${esc(text(p, 'NCM'))}</td><td>${esc(text(icms, 'orig'))}${esc(text(icms, 'CST') || text(icms, 'CSOSN'))}</td><td>${esc(text(p, 'CFOP'))}</td><td>${esc(text(p, 'uCom'))}</td><td class="r">${num(text(p, 'qCom'), 4)}</td><td class="r">${num(text(p, 'vUnCom'), 4)}</td><td class="r">${num(text(p, 'vProd'))}</td><td class="r">${num(text(p, 'vDesc') || '0')}</td><td class="r">${num(text(icms, 'vBC') || '0')}</td><td class="r">${num(text(icms, 'vICMS') || '0')}</td><td class="r">${num(text(ipi, 'vIPI') || '0')}</td><td class="r">${num(text(icms, 'pICMS') || '0')}</td><td class="r">${num(text(ipi, 'pIPI') || '0')}</td></tr>`;
  }).join('');
  const dups = all(inf, 'dup').map((d) => `<div class="box"><span class="l">Nº ${esc(text(d, 'nDup'))}</span><span class="v">${date(text(d, 'dVenc'), false)} · ${money(text(d, 'vDup'))}</span></div>`).join('');
  const PAG: Record<string, string> = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '10': 'Vale alimentação', '11': 'Vale refeição', '12': 'Vale presente', '13': 'Vale combustível', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '19': 'Fidelidade', '90': 'Sem pagamento', '99': 'Outros' };
  const pags = all(inf, 'detPag').map((d) => `${esc(PAG[text(d, 'tPag')] ?? text(d, 'tPag'))} ${money(text(d, 'vPag'))}`).join(' · ');
  const vol = find(transp, 'vol'), transporta = find(transp, 'transporta'), FRETE: Record<string, string> = { '0': '0 - Emitente', '1': '1 - Destinatário', '2': '2 - Terceiros', '3': '3 - Próprio rem.', '4': '4 - Próprio dest.', '9': '9 - Sem frete' };
  const totalBox = (label: string, v: string, strong = false) => `<div class="box"><span class="l">${label}</span><span class="v r" style="display:block${strong ? ';font-weight:bold' : ''}">${num(v || '0')}</span></div>`;
  const autoriz = prot ? `${text(prot, 'nProt')} ${date(text(prot, 'dhRecbto'))}` : 'NF-e sem protocolo de autorização no arquivo';
  const intermed = find(inf, 'infIntermed');
  const info = [text(inf, 'infAdic/infCpl'), intermed ? `Intermediador: CNPJ ${doc(text(intermed, 'CNPJ'))} ${text(intermed, 'idCadIntTran')}` : '', pags ? `Pagamento: ${pags}` : ''].filter(Boolean).join('\n');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${CSP}<style>@page{size:A4;margin:7mm}${BASE_CSS}.danfe-title{font-size:15pt;font-weight:bold;letter-spacing:1px}.barcode svg{width:100%;height:40px}</style><body>
${homolog ? '<div class="watermark">SEM VALOR FISCAL<br>HOMOLOGAÇÃO</div>' : ''}
<div class="row"><div class="box" style="flex:5"><span class="l">Recebemos de ${esc(text(emit, 'xNome'))} os produtos/serviços constantes da nota fiscal indicada ao lado · Emissão ${date(text(ide, 'dhEmi') || text(ide, 'dEmi'), false)} · Dest.: ${esc(text(dest, 'xNome'))} · Valor total: ${money(text(tot, 'vNF'))}</span></div><div class="box c" style="flex:1.2"><b>NF-e</b><br>Nº ${nNF}<br>Série ${serie}</div></div>
<div class="row"><div class="box" style="flex:1"><span class="l">Data de recebimento</span></div><div class="box" style="flex:4"><span class="l">Identificação e assinatura do recebedor</span></div><div class="box" style="flex:1.2;border-top:none"></div></div>
<div style="border-top:1px dashed #000;margin:6px 0"></div>
<div class="row"><div class="box" style="flex:3.2;min-height:96px"><span class="l">Identificação do emitente</span><div style="font-size:10.5pt;font-weight:bold;margin:4px 0">${esc(text(emit, 'xNome'))}</div><div class="v">${esc(ender(find(emit, 'enderEmit')))}<br>${esc(text(emit, 'enderEmit/xBairro'))} · ${esc(text(emit, 'enderEmit/xMun'))}/${esc(text(emit, 'enderEmit/UF'))} · CEP ${cep(text(emit, 'enderEmit/CEP'))}<br>${text(emit, 'enderEmit/fone') ? 'Fone ' + phone(text(emit, 'enderEmit/fone')) : ''}</div></div>
<div class="box c" style="flex:1.7"><div class="danfe-title">DANFE</div><div class="v" style="font-size:7pt">Documento Auxiliar da Nota Fiscal Eletrônica</div><div class="v" style="margin:4px 0">${text(ide, 'tpNF') === '0' ? '0 - Entrada' : '1 - Saída'}</div><b>Nº ${nNF}</b><br>Série ${serie}<br><span style="font-size:7pt">Folha 1/1</span></div>
<div class="box" style="flex:3.3"><div class="barcode">${chave ? await barcode(chave) : ''}</div><span class="l">Chave de acesso</span><div class="v c" style="font-weight:bold;letter-spacing:.3px">${chaveFmt(chave)}</div><div class="v c" style="font-size:7pt;margin-top:3px">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora</div></div></div>
<div class="row"><div class="box" style="flex:5"><span class="l">Natureza da operação</span><span class="v">${esc(text(ide, 'natOp'))}</span></div><div class="box" style="flex:3.3"><span class="l">Protocolo de autorização de uso</span><span class="v">${esc(autoriz)}</span></div></div>
<div class="row"><div class="box"><span class="l">Inscrição estadual</span><span class="v">${esc(text(emit, 'IE'))}</span></div><div class="box"><span class="l">Insc. estadual do subst. trib.</span><span class="v">${esc(text(emit, 'IEST'))}</span></div><div class="box"><span class="l">CNPJ / CPF</span><span class="v">${docOf(emit)}</span></div></div>
<div class="sec">Destinatário / Remetente</div>
<div class="row"><div class="box" style="flex:4"><span class="l">Nome / Razão social</span><span class="v">${esc(text(dest, 'xNome'))}</span></div><div class="box" style="flex:1.6"><span class="l">CNPJ / CPF</span><span class="v">${docOf(dest)}</span></div><div class="box" style="flex:1.1"><span class="l">Data da emissão</span><span class="v">${date(text(ide, 'dhEmi') || text(ide, 'dEmi'), false)}</span></div></div>
<div class="row"><div class="box" style="flex:3.2"><span class="l">Endereço</span><span class="v">${esc(ender(find(dest, 'enderDest')))}</span></div><div class="box" style="flex:1.4"><span class="l">Bairro / Distrito</span><span class="v">${esc(text(dest, 'enderDest/xBairro'))}</span></div><div class="box" style="flex:1"><span class="l">CEP</span><span class="v">${cep(text(dest, 'enderDest/CEP'))}</span></div><div class="box" style="flex:1.1"><span class="l">Data saída/entrada</span><span class="v">${date(text(ide, 'dhSaiEnt') || text(ide, 'dSaiEnt'), false)}</span></div></div>
<div class="row"><div class="box" style="flex:2.4"><span class="l">Município</span><span class="v">${esc(text(dest, 'enderDest/xMun'))}</span></div><div class="box" style="flex:1.4"><span class="l">Fone / Fax</span><span class="v">${phone(text(dest, 'enderDest/fone'))}</span></div><div class="box" style="flex:.5"><span class="l">UF</span><span class="v">${esc(text(dest, 'enderDest/UF'))}</span></div><div class="box" style="flex:1.6"><span class="l">Inscrição estadual</span><span class="v">${esc(text(dest, 'IE'))}</span></div><div class="box" style="flex:1.1"><span class="l">Hora da saída</span><span class="v">${(text(ide, 'dhSaiEnt').split('T')[1] ?? '').slice(0, 8)}</span></div></div>
${dups ? `<div class="sec">Fatura / Duplicatas</div><div class="row">${dups}</div>` : ''}
<div class="sec">Cálculo do imposto</div>
<div class="row">${totalBox('Base de cálc. do ICMS', text(tot, 'vBC'))}${totalBox('Valor do ICMS', text(tot, 'vICMS'))}${totalBox('Base cálc. ICMS ST', text(tot, 'vBCST'))}${totalBox('Valor do ICMS subst.', text(tot, 'vST'))}${totalBox('Valor imp. importação', text(tot, 'vII'))}${totalBox('Valor total dos produtos', text(tot, 'vProd'), true)}</div>
<div class="row">${totalBox('Valor do frete', text(tot, 'vFrete'))}${totalBox('Valor do seguro', text(tot, 'vSeg'))}${totalBox('Desconto', text(tot, 'vDesc'))}${totalBox('Outras despesas', text(tot, 'vOutro'))}${totalBox('Valor do IPI', text(tot, 'vIPI'))}${totalBox('Valor total da nota', text(tot, 'vNF'), true)}</div>
<div class="sec">Transportador / Volumes transportados</div>
<div class="row"><div class="box" style="flex:3"><span class="l">Razão social</span><span class="v">${esc(text(transporta, 'xNome'))}</span></div><div class="box" style="flex:1.4"><span class="l">Frete por conta</span><span class="v">${FRETE[text(transp, 'modFrete')] ?? ''}</span></div><div class="box"><span class="l">Placa do veículo</span><span class="v">${esc(text(transp, 'veicTransp/placa'))}</span></div><div class="box" style="flex:1.4"><span class="l">CNPJ / CPF</span><span class="v">${docOf(transporta)}</span></div></div>
<div class="row"><div class="box"><span class="l">Quantidade</span><span class="v">${esc(text(vol, 'qVol'))}</span></div><div class="box"><span class="l">Espécie</span><span class="v">${esc(text(vol, 'esp'))}</span></div><div class="box"><span class="l">Marca</span><span class="v">${esc(text(vol, 'marca'))}</span></div><div class="box"><span class="l">Peso bruto</span><span class="v">${num(text(vol, 'pesoB'), 3)}</span></div><div class="box"><span class="l">Peso líquido</span><span class="v">${num(text(vol, 'pesoL'), 3)}</span></div></div>
<div class="sec">Dados dos produtos / serviços</div>
<table><thead><tr><th>Código</th><th style="width:30%">Descrição do produto / serviço</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>Un.</th><th>Quant.</th><th>Valor unit.</th><th>Valor total</th><th>Desc.</th><th>BC ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th></tr></thead><tbody>${items}</tbody></table>
<div class="sec">Dados adicionais</div>
<div class="row"><div class="box" style="flex:2.2;min-height:90px"><span class="l">Informações complementares</span><span class="v" style="font-size:7.5pt">${lines(info)}</span>${text(inf, 'infAdic/infAdFisco') ? `<span class="v" style="font-size:7.5pt"><br>${lines(text(inf, 'infAdic/infAdFisco'))}</span>` : ''}</div><div class="box"><span class="l">Reservado ao fisco</span></div></div>
<div style="font-size:6pt;color:#555;margin-top:4px;text-align:right">DANFE gerado localmente pelo GCP-PDF a partir do XML autorizado</div>
</body></html>`;
}

/* ---------------- NFC-e (modelo 65): DANFE NFC-e em bobina 80 mm ---------------- */
async function danfeNfce(root: Element): Promise<{ html: string; height: number }> {
  const inf = find(root, 'infNFe')!, ide = find(inf, 'ide'), emit = find(inf, 'emit'), dest = find(inf, 'dest'), tot = find(inf, 'total/ICMSTot');
  const prot = find(root, 'protNFe/infProt'), chave = (inf.getAttribute('Id') ?? '').replace(/^NFe/, '') || text(prot, 'chNFe');
  const qrText = text(root, 'infNFeSupl/qrCode'), url = text(root, 'infNFeSupl/urlChave');
  const dets = all(inf, 'det');
  // Two lines per item, as the coupon printers do: number, code and description, then quantity × unit price = total.
  const qty = (v: string) => (Number(v) % 1 ? num(v, 3) : String(Number(v)));
  const items = dets.map((det, i) => { const p = find(det, 'prod'); return `<div class="item"><div>${String(i + 1).padStart(3, '0')} ${esc(text(p, 'cProd'))} ${esc(text(p, 'xProd'))}</div><div>${qty(text(p, 'qCom'))} ${esc(text(p, 'uCom'))} x R$ ${num(text(p, 'vUnCom'))} = R$ ${num(text(p, 'vProd'))}</div></div>`; }).join('');
  const PAG: Record<string, string> = { '01': 'Dinheiro', '03': 'Cartão de crédito', '04': 'Cartão de débito', '17': 'PIX', '99': 'Outros', '05': 'Crédito loja', '10': 'Vale alimentação', '11': 'Vale refeição' };
  const pags = all(inf, 'detPag').map((d) => `<div class="line"><span>${esc(PAG[text(d, 'tPag')] ?? 'Pagamento ' + text(d, 'tPag'))}</span><span>${num(text(d, 'vPag'))}</span></div>`).join('');
  const troco = text(inf, 'pag/vTroco');
  const homolog = text(ide, 'tpAmb') === '2';
  const height = Math.ceil(150 + dets.length * 8 + (qrText ? 50 : 0) + text(inf, 'infAdic/infCpl').length / 12);
  return { height, html: `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${CSP}<style>@page{size:80mm ${height}mm;margin:3mm}body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:7.4pt;color:#000}.c{text-align:center}.r{text-align:right}
hr{border:0;border-top:1px dashed #000;margin:5px 0}table{width:100%;border-collapse:collapse}th,td{font-size:6.6pt;padding:1px 1px;vertical-align:top}th{text-align:left;border-bottom:1px solid #000}.line{display:flex;justify-content:space-between}.big{font-weight:bold;font-size:8.6pt}.qr svg{width:30mm;height:30mm}.item{margin:2px 0;line-height:1.35}.items-head{font-size:6.8pt;margin-bottom:3px}</style><body>
<div class="c"><b>${esc(text(emit, 'xNome'))}</b><br>CNPJ ${docOf(emit)} · IE ${esc(text(emit, 'IE'))}<br>${esc([text(emit, 'enderEmit/xLgr'), text(emit, 'enderEmit/nro'), text(emit, 'enderEmit/xBairro'), text(emit, 'enderEmit/xMun') + '/' + text(emit, 'enderEmit/UF')].filter(Boolean).join(', '))}</div>
<hr><div class="c"><b>DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</b>${homolog ? '<br><b>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</b>' : ''}</div><hr>
<div class="items-head"><b>ITEM CÓDIGO DESCRIÇÃO<br>QTD. UN. V. UNITÁRIO R$ / V. TOTAL R$</b></div>${items}<hr>
<div class="line"><span>Qtde. total de itens</span><span>${dets.length}</span></div>
<div class="line"><span>Valor total R$</span><span>${num(text(tot, 'vProd'))}</span></div>
${Number(text(tot, 'vDesc')) ? `<div class="line"><span>Descontos R$</span><span>${num(text(tot, 'vDesc'))}</span></div>` : ''}
${Number(text(tot, 'vOutro')) || Number(text(tot, 'vFrete')) ? `<div class="line"><span>Acréscimos R$</span><span>${num(String(Number(text(tot, 'vOutro') || 0) + Number(text(tot, 'vFrete') || 0)))}</span></div>` : ''}
<div class="line big"><span>Valor a pagar R$</span><span>${num(text(tot, 'vNF'))}</span></div>
<div class="line" style="margin-top:3px"><b>Forma de pagamento</b><b>Valor pago R$</b></div>${pags}${troco ? `<div class="line"><span>Troco R$</span><span>${num(troco)}</span></div>` : ''}<hr>
<div class="c"><b>CHAVE DE ACESSO</b><br>${chaveFmt(chave)}<br>Consulte pela chave de acesso em ${esc(url || 'portal da Sefaz do seu estado')}</div><hr>
<div class="c">${dest ? `CONSUMIDOR ${docOf(dest) ? `CPF/CNPJ ${docOf(dest)}` : ''} ${esc(text(dest, 'xNome'))}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div><hr>
<div class="c"><b>NFC-e nº ${esc(text(ide, 'nNF'))} Série ${esc(text(ide, 'serie'))} ${date(text(ide, 'dhEmi'))}</b><br>${prot ? `Protocolo de autorização: ${esc(text(prot, 'nProt'))}<br>Data de autorização: ${date(text(prot, 'dhRecbto'))}` : 'Sem protocolo de autorização no arquivo'}</div>
${qrText ? `<div class="c qr" style="margin-top:4px">${await qr(qrText)}<div>Consulte a autenticidade pelo QR Code</div><div style="font-size:5.6pt;word-break:break-all">${esc(qrText)}</div></div>` : ''}
${Number(text(tot, 'vTotTrib')) ? `<hr><div class="c">Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${num(text(tot, 'vTotTrib'))}</div>` : ''}
${text(inf, 'infAdic/infCpl') ? `<hr><div class="c" style="font-size:6.4pt">${lines(text(inf, 'infAdic/infCpl'))}</div>` : ''}
</body></html>` };
}

/* ---------------- NFS-e Padrão Nacional: DANFSe v2.0 ---------------- */
async function danfse(root: Element): Promise<string> {
  const inf = find(root, 'infNFSe')!, dps = find(inf, 'infDPS'), emit = find(inf, 'emit'), prest = find(dps, 'prest'), toma = find(dps, 'toma'), serv = find(dps, 'serv'), val = find(dps, 'valores'), trib = find(val, 'trib');
  const chave = (inf.getAttribute('Id') ?? '').replace(/^NFS/, '');
  const qrSvg = chave ? await qr(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`) : '';
  const homolog = text(dps, 'tpAmb') === '2';
  const cell = (label: string, value: string, flex = 1) => `<div class="box" style="flex:${flex}"><span class="l">${label}</span><span class="v">${value || '-'}</span></div>`;
  const tomaEnd = find(toma, 'end'), emitEnd = find(emit, 'enderNac');
  const enderToma = [text(tomaEnd, 'xLgr'), text(tomaEnd, 'nro'), text(tomaEnd, 'xCpl'), text(tomaEnd, 'xBairro')].filter(Boolean).join(', ');
  const enderEmit = [text(emitEnd, 'xLgr'), text(emitEnd, 'nro'), text(emitEnd, 'xCpl'), text(emitEnd, 'xBairro')].filter(Boolean).join(', ');
  const SN: Record<string, string> = { '1': 'Não optante', '2': 'Optante - Microempreendedor Individual (MEI)', '3': 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)' };
  const RET: Record<string, string> = { '1': 'Não retido', '2': 'Retido pelo tomador', '3': 'Retido pelo intermediário' };
  const TRIB: Record<string, string> = { '1': 'Operação tributável', '2': 'Imunidade', '3': 'Exportação de serviço', '4': 'Não incidência' };
  const vServ = text(val, 'vServPrest/vServ'), vLiq = text(inf, 'valores/vLiq') || vServ;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${CSP}<style>@page{size:A4;margin:8mm}${BASE_CSS}.head{display:flex;align-items:center;border:1px solid #000;padding:6px}.qr svg{width:26mm;height:26mm}
.band{font-weight:bold;font-size:8pt;text-transform:uppercase;background:#ececec;border:1px solid #000;border-top:none;padding:2px 4px}</style><body>
${homolog ? '<div class="watermark">SEM VALOR FISCAL<br>HOMOLOGAÇÃO</div>' : ''}
<div class="head"><div style="flex:1;font-size:15pt;font-weight:bold;color:#1f5f99">NFS<span style="color:#7aa83f">e</span><div style="font-size:6.5pt;color:#333;font-weight:normal">Nota Fiscal de Serviço eletrônica</div></div>
<div style="flex:2;text-align:center"><b style="font-size:11pt">DANFSe v2.0</b><br><b>Documento Auxiliar da NFS-e</b></div>
<div style="flex:1.4;font-size:8pt">Município: ${esc(text(inf, 'xLocEmi'))}<br>Ambiente gerador: ${esc(text(inf, 'ambGer'))}<br>Tipo de ambiente: ${esc(text(dps, 'tpAmb'))}</div></div>
<div class="row"><div class="box" style="flex:3"><span class="l">Chave de acesso da NFS-e</span><span class="v" style="font-weight:bold">${esc(chave)}</span>
<div class="row" style="margin-top:4px">${cell('Número da NFS-e', esc(text(inf, 'nNFSe')))}${cell('Competência da NFS-e', date(text(dps, 'dCompet'), false))}${cell('Data e hora da emissão da NFS-e', date(text(inf, 'dhProc')))}</div>
<div class="row">${cell('Número da DPS', esc(text(dps, 'nDPS')))}${cell('Série da DPS', esc(text(dps, 'serie')))}${cell('Data e hora da emissão da DPS', date(text(dps, 'dhEmi')))}</div>
<div class="row">${cell('Emitente da NFS-e', text(dps, 'tpEmit') === '1' ? 'Prestador' : text(dps, 'tpEmit') === '2' ? 'Tomador' : 'Intermediário')}${cell('Situação da NFS-e', text(inf, 'cStat') === '100' ? 'NFS-e gerada' : esc(text(inf, 'cStat')))}${cell('Finalidade', '-')}</div></div>
<div class="box c qr" style="flex:1">${qrSvg}<div style="font-size:6pt;margin-top:2px">A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e</div></div></div>
<div class="band">Prestador / Fornecedor</div>
<div class="row">${cell('Nome / Nome empresarial', esc(text(emit, 'xNome')), 2)}${cell('CNPJ / CPF / NIF', docOf(emit) || docOf(prest))}${cell('Indicador municipal (inscrição)', esc(text(emit, 'IM') || text(prest, 'IM')))}${cell('Telefone', phone(text(prest, 'fone') || text(emit, 'fone')))}</div>
<div class="row">${cell('Endereço', esc(enderEmit), 2)}${cell('Município / Sigla UF', `${esc(text(inf, 'xLocEmi'))} / ${esc(text(emitEnd, 'UF'))}`)}${cell('Código IBGE / CEP', `${esc(text(emitEnd, 'cMun'))} / ${cep(text(emitEnd, 'CEP'))}`)}${cell('E-mail', esc((text(prest, 'email') || text(emit, 'email')).toLowerCase()))}</div>
<div class="row">${cell('Simples Nacional na data de competência', SN[text(prest, 'regTrib/opSimpNac')] ?? '-', 2)}${cell('Regime de apuração tributária pelo SN', text(prest, 'regTrib/regApTribSN') === '1' ? 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional' : text(prest, 'regTrib/regApTribSN') ? 'Tributos federais pelo SN e ISSQN pela NFS-e' : '-', 3)}</div>
<div class="band">Tomador / Adquirente</div>
<div class="row">${cell('Nome / Nome empresarial', esc(text(toma, 'xNome')), 2)}${cell('CNPJ / CPF / NIF', docOf(toma))}${cell('Indicador municipal (inscrição)', esc(text(toma, 'IM')))}${cell('Telefone', phone(text(toma, 'fone')))}</div>
<div class="row">${cell('Endereço', esc(enderToma), 2)}${cell('Código IBGE / CEP', `${esc(text(tomaEnd, 'cMun'))} / ${cep(text(tomaEnd, 'CEP'))}`)}${cell('E-mail', esc(text(toma, 'email').toLowerCase()), 2)}</div>
<div class="band">Serviço prestado</div>
<div class="row">${cell('Código de tributação nacional / municipal', `${esc(text(serv, 'cServ/cTribNac').replace(/(\d{2})(\d{2})(\d{2})/, '$1.$2.$3'))} / ${esc(text(serv, 'cServ/cTribMun'))}`)}${cell('Código da NBS', esc(text(serv, 'cServ/cNBS')))}${cell('Local da prestação', esc(text(inf, 'xLocPrestacao')))}</div>
<div class="box" style="border-top:none"><span class="l">Tributação nacional</span><span class="v">${esc(text(inf, 'xTribNac'))}</span></div>
<div class="box" style="border-top:none;min-height:42px"><span class="l">Descrição do serviço</span><span class="v">${lines(text(serv, 'cServ/xDescServ'))}</span></div>
<div class="band">Tributação municipal (ISSQN)</div>
<div class="row">${cell('Tipo de tributação do ISSQN', TRIB[text(trib, 'tribMun/tribISSQN')] ?? '-')}${cell('Município de incidência', esc(text(inf, 'xLocIncid')))}${cell('Retenção do ISSQN', RET[text(trib, 'tribMun/tpRetISSQN')] ?? '-')}${cell('Alíquota aplicada', text(trib, 'tribMun/pAliq') ? num(text(trib, 'tribMun/pAliq')) + '%' : '-')}${cell('ISSQN apurado', money(text(inf, 'valores/vISSQN')) || '-')}</div>
<div class="band">Tributação federal</div>
<div class="row">${cell('IRRF', money(text(trib, 'tribFed/vRetIRRF')))}${cell('Contribuição previdenciária retida', money(text(trib, 'tribFed/vRetCP')))}${cell('PIS / COFINS (CST)', esc(text(trib, 'tribFed/piscofins/CST')))}${cell('Retenção PIS/COFINS/CSLL', text(trib, 'tribFed/piscofins/tpRetPisCofins') === '0' ? 'Não retidos' : esc(text(trib, 'tribFed/piscofins/tpRetPisCofins')))}</div>
<div class="band">Valor total da NFS-e</div>
<div class="row">${cell('Valor do serviço', money(vServ))}${cell('Desconto incondicionado', money(text(val, 'vDescCondIncond/vDescIncond')))}${cell('Desconto condicionado', money(text(val, 'vDescCondIncond/vDescCond')))}${cell('Total das retenções', money(text(inf, 'valores/vTotalRet')))}<div class="box" style="flex:1"><span class="l">Valor líquido da NFS-e</span><span class="v" style="font-weight:bold;font-size:11pt">${money(vLiq)}</span></div></div>
<div class="band">Informações complementares</div>
<div class="box" style="border-top:none;min-height:40px"><span class="v">${text(trib, 'totTrib/pTotTribSN') ? `Total aproximado dos tributos (Simples Nacional): ${num(text(trib, 'totTrib/pTotTribSN'))}%` : ''}${text(dps, 'xInfComp') ? `<br>${lines(text(dps, 'xInfComp'))}` : ''}</span></div>
<div style="font-size:6pt;color:#555;margin-top:4px;text-align:right">DANFSe gerado localmente pelo GCP-PDF a partir do XML da NFS-e</div>
</body></html>`;
}

/* ---------------- NFS-e municipal (ABRASF e derivados) ---------------- */
async function nfseAbrasf(root: Element): Promise<string> {
  const inf = find(root, 'InfNfse') ?? root, servico = find(inf, 'Servico') ?? find(root, 'Servico'), val = find(servico, 'Valores');
  const prest = find(inf, 'PrestadorServico') ?? find(root, 'Prestador'), toma = find(inf, 'TomadorServico') ?? find(root, 'Tomador') ?? find(root, 'TomadorServico');
  const id = (e: Node) => doc(text(e, 'Cnpj') || text(e, 'Cpf') || text(e, 'CNPJ') || text(e, 'CPF'));
  const end = (e: Node) => { const x = find(e, 'Endereco'); return [text(x, 'Endereco'), text(x, 'Numero'), text(x, 'Complemento'), text(x, 'Bairro'), text(x, 'Cep') && 'CEP ' + cep(text(x, 'Cep')), text(x, 'Uf')].filter(Boolean).join(', '); };
  const cell = (label: string, value: string, flex = 1) => `<div class="box" style="flex:${flex}"><span class="l">${label}</span><span class="v">${value || '-'}</span></div>`;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${CSP}<style>@page{size:A4;margin:9mm}${BASE_CSS}.band{font-weight:bold;font-size:8pt;text-transform:uppercase;background:#ececec;border:1px solid #000;border-top:none;padding:2px 4px}</style><body>
<div class="box c" style="padding:8px"><b style="font-size:13pt">NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e</b><br><span class="v">Layout municipal (ABRASF) · ${esc(text(inf, 'OrgaoGerador/CodigoMunicipio') || text(servico, 'CodigoMunicipio'))}</span></div>
<div class="row">${cell('Número da NFS-e', esc(text(inf, 'Numero')))}${cell('Data e hora da emissão', date(text(inf, 'DataEmissao')))}${cell('Competência', date(text(inf, 'Competencia') || text(root, 'Competencia'), false))}${cell('Código de verificação', esc(text(inf, 'CodigoVerificacao')))}</div>
<div class="band">Prestador de serviços</div>
<div class="row">${cell('Razão social', esc(text(prest, 'RazaoSocial') || text(prest, 'NomeFantasia')), 2)}${cell('CNPJ / CPF', id(prest))}${cell('Inscrição municipal', esc(text(prest, 'InscricaoMunicipal')))}</div>
<div class="box" style="border-top:none"><span class="l">Endereço</span><span class="v">${esc(end(prest))}</span></div>
<div class="band">Tomador de serviços</div>
<div class="row">${cell('Razão social', esc(text(toma, 'RazaoSocial')), 2)}${cell('CNPJ / CPF', id(toma))}${cell('Inscrição municipal', esc(text(toma, 'InscricaoMunicipal')))}</div>
<div class="box" style="border-top:none"><span class="l">Endereço</span><span class="v">${esc(end(toma))}</span></div>
<div class="band">Discriminação dos serviços</div>
<div class="box" style="border-top:none;min-height:120px"><span class="v">${lines(text(servico, 'Discriminacao'))}</span></div>
<div class="row">${cell('Item da lista de serviços', esc(text(servico, 'ItemListaServico')))}${cell('Código de tributação municipal', esc(text(servico, 'CodigoTributacaoMunicipio')))}${cell('CNAE', esc(text(servico, 'CodigoCnae')))}</div>
<div class="band">Valores</div>
<div class="row">${cell('Valor dos serviços', money(text(val, 'ValorServicos')))}${cell('Deduções', money(text(val, 'ValorDeducoes')))}${cell('Base de cálculo', money(text(val, 'BaseCalculo') || text(inf, 'ValoresNfse/BaseCalculo')))}${cell('Alíquota', text(val, 'Aliquota') ? num(text(val, 'Aliquota'), 2) : '')}${cell('Valor do ISS', money(text(val, 'ValorIss') || text(inf, 'ValoresNfse/ValorIss')))}</div>
<div class="row">${cell('PIS', money(text(val, 'ValorPis')))}${cell('COFINS', money(text(val, 'ValorCofins')))}${cell('INSS', money(text(val, 'ValorInss')))}${cell('IR', money(text(val, 'ValorIr')))}${cell('CSLL', money(text(val, 'ValorCsll')))}<div class="box"><span class="l">Valor líquido</span><span class="v" style="font-weight:bold">${money(text(val, 'ValorLiquidoNfse') || text(inf, 'ValoresNfse/ValorLiquidoNfse') || text(val, 'ValorServicos'))}</span></div></div>
${text(inf, 'OutrasInformacoes') ? `<div class="band">Outras informações</div><div class="box" style="border-top:none"><span class="v">${lines(text(inf, 'OutrasInformacoes'))}</span></div>` : ''}
<div style="font-size:6pt;color:#555;margin-top:4px;text-align:right">Gerado localmente pelo GCP-PDF. Cada prefeitura tem seu próprio modelo visual; confira a versão oficial no portal do município.</div>
</body></html>`;
}

/* ---------------- Qualquer outro XML fiscal: todos os campos, agrupados ---------------- */
function generic(root: Element, title: string): string {
  const rows: string[] = [];
  const walk = (e: Element, depth: number, path: string) => {
    const children = kids(e).filter((c) => local(c) !== 'Signature');
    if (!children.length) { const v = (e.textContent ?? '').trim(); if (v) rows.push(`<tr><td style="padding-left:${4 + depth * 8}px">${esc(local(e))}</td><td>${lines(v)}</td></tr>`); return; }
    rows.push(`<tr><th colspan="2" style="text-align:left;padding-left:${4 + depth * 8}px">${esc(path ? path + ' › ' : '')}${esc(local(e))}</th></tr>`);
    for (const c of children) walk(c, depth + 1, '');
  };
  walk(root, 0, '');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8">${CSP}<style>@page{size:A4;margin:10mm}${BASE_CSS}td:first-child{width:32%;color:#333}</style><body><h2 style="font-size:13pt;margin:0 0 6px">${esc(title)}</h2><p style="font-size:7.5pt;margin:0 0 8px">Formato sem modelo visual oficial reconhecido pelo GCP-PDF: todos os campos do XML estão listados abaixo, na ordem do arquivo.</p><table>${rows.join('')}</table></body></html>`;
}

export function fiscalKind(root: Element): FiscalKind {
  const name = local(root), ns = root.namespaceURI ?? '';
  const inf = find(root, 'infNFe') ?? (name === 'infNFe' ? root : null);
  if (inf || /portalfiscal\.inf\.br\/nfe/.test(ns)) return text(inf, 'ide/mod') === '65' ? 'nfce' : 'nfe';
  if (/sped\.fazenda\.gov\.br\/nfse/.test(ns) || find(root, 'infNFSe')) return 'nfse-nacional';
  if (find(root, 'InfNfse') || /abrasf|nfse/i.test(ns) || /nfse/i.test(name)) return 'nfse-abrasf';
  return 'generico';
}
const LABEL: Record<FiscalKind, string> = { nfe: 'NF-e (DANFE)', nfce: 'NFC-e (DANFE NFC-e)', 'nfse-nacional': 'NFS-e Nacional (DANFSe)', 'nfse-abrasf': 'NFS-e municipal (ABRASF)', generico: 'XML fiscal' };

/** Decodes as UTF-8 (the standard) and falls back to Latin-1 for the municipal files that ignore it. */
export function decodeXml(bytes: Uint8Array) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('latin1').decode(bytes); }
}
export async function fiscalXmlToPdf(bytes: Uint8Array, htmlToPdf: HtmlToPdf, htmlToPdfSized?: (html: string, widthMm: number, heightMm: number) => Promise<Uint8Array>): Promise<{ bytes: Uint8Array; kind: FiscalKind; label: string }> {
  const source = decodeXml(bytes).replace(/^﻿/, '');
  const errors: string[] = [];
  const parsed = new DOMParser({ onError: (level: string, message: string) => { if (level !== 'warning') errors.push(message); } } as never).parseFromString(source, 'text/xml');
  const root = parsed.documentElement as unknown as Element | null;
  if (!root || errors.length && !kids(root).length) throw new Error('Este arquivo XML está malformado e não pôde ser lido.');
  const kind = fiscalKind(root);
  let out: Uint8Array;
  if (kind === 'nfe') out = await htmlToPdf(await danfe(root));
  else if (kind === 'nfce') { const { html, height } = await danfeNfce(root); out = htmlToPdfSized ? await htmlToPdfSized(html, 80, height) : await htmlToPdf(html); }
  else if (kind === 'nfse-nacional') out = await htmlToPdf(await danfse(root));
  else if (kind === 'nfse-abrasf') out = await htmlToPdf(await nfseAbrasf(root));
  else out = await htmlToPdf(generic(root, local(root) === 'cteProc' || find(root, 'infCte') ? 'CT-e — Conhecimento de Transporte eletrônico' : `Documento XML — ${local(root)}`));
  return { bytes: out, kind, label: LABEL[kind] };
}
/** Exposed for tests: the HTML of each layout. */
export async function fiscalHtml(bytes: Uint8Array) {
  const root = new DOMParser().parseFromString(decodeXml(bytes), 'text/xml').documentElement as unknown as Element;
  const kind = fiscalKind(root);
  return { kind, html: kind === 'nfe' ? await danfe(root) : kind === 'nfce' ? (await danfeNfce(root)).html : kind === 'nfse-nacional' ? await danfse(root) : kind === 'nfse-abrasf' ? await nfseAbrasf(root) : generic(root, local(root)) };
}
