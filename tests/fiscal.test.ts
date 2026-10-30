import test from 'node:test';
import assert from 'node:assert/strict';
import { fiscalHtml, decodeXml } from '../src/main/fiscal';

const enc = (s: string) => new TextEncoder().encode(s);
const nfe = (mod: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe versao="4.00" Id="NFe31230511222333000181${mod}0010000000211132316177"><ide><mod>${mod}</mod><serie>1</serie><nNF>21</nNF><natOp>Venda</natOp><dhEmi>2023-05-16T10:37:17-03:00</dhEmi><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>Loja Exemplo</xNome><enderEmit><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><xMun>Nova Lima</xMun><UF>MG</UF><CEP>34007714</CEP></enderEmit><IE>0012345670089</IE></emit>
<det nItem="1"><prod><cProd>805783</cProd><xProd>Rucula</xProd><NCM>07099990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>5.00</vUnCom><vProd>5.00</vProd>${extra}</prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vProd>5.00</vProd><vNF>5.00</vNF><vII>1.50</vII></ICMSTot></total><pag><detPag><tPag>01</tPag><vPag>5.00</vPag></detPag></pag></infNFe>
<infNFeSupl><qrCode><![CDATA[https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=31230511222333000181650010000000211132316177|2|1]]></qrCode><urlChave>https://portalsped.fazenda.mg.gov.br/portalnfce</urlChave></infNFeSupl></NFe>
<protNFe><infProt><nProt>131200000000001</nProt><dhRecbto>2023-05-16T10:37:19-03:00</dhRecbto></infProt></protNFe></nfeProc>`;

test('NF-e modelo 55 becomes a DANFE with barcode, protocol and import declaration', async () => {
  const { kind, html } = await fiscalHtml(enc(nfe('55', '<DI><nDI>2301234567</nDI><dDI>2023-05-01</dDI><xLocDesemb>Santos</xLocDesemb><UFDesemb>SP</UFDesemb><dDesemb>2023-05-03</dDesemb><adi><nAdicao>1</nAdicao></adi></DI>')));
  assert.equal(kind, 'nfe');
  assert.match(html, /DANFE/);
  assert.match(html, /<svg/);
  assert.match(html, /3123 0511 2223 3300 0181 5500/);
  assert.match(html, /131200000000001/);
  assert.match(html, /DI 2301234567 de 01\/05\/2023/);
  assert.match(html, /Valor imp\. importação/);
  assert.match(html, /11\.222\.333\/0001-81/);
});

test('NFC-e modelo 65 becomes the 80 mm coupon with item lines and QR code', async () => {
  const { kind, html } = await fiscalHtml(enc(nfe('65')));
  assert.equal(kind, 'nfce');
  assert.match(html, /size:80mm/);
  assert.match(html, /001 805783 Rucula/);
  assert.match(html, /1 UN x R\$ 5,00 = R\$ 5,00/);
  assert.match(html, /CONSUMIDOR NÃO IDENTIFICADO/);
  assert.match(html, /<svg/);
});

test('NFS-e Padrão Nacional becomes a DANFSe; ABRASF and unknown XML keep every field', async () => {
  const nacional = `<NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS31062002244555666000172000000000004126107160490405"><xLocEmi>Belo Horizonte</xLocEmi><nNFSe>41</nNFSe><cStat>100</cStat><dhProc>2026-10-21T09:37:46-03:00</dhProc><emit><CNPJ>44555666000172</CNPJ><xNome>PRESTADOR EXEMPLO</xNome></emit><valores><vLiq>4000.00</vLiq></valores><DPS><infDPS><tpAmb>1</tpAmb><toma><CNPJ>77888999000163</CNPJ><xNome>TOMADOR EXEMPLO</xNome></toma><serv><cServ><cTribNac>170202</cTribNac><xDescServ>Apoio administrativo</xDescServ></cServ></serv><valores><vServPrest><vServ>4000.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;
  const a = await fiscalHtml(enc(nacional));
  assert.equal(a.kind, 'nfse-nacional');
  assert.match(a.html, /DANFSe v2\.0/);
  assert.match(a.html, /R\$ 4\.000,00/);
  assert.match(a.html, /17\.02\.02/);
  const abrasf = await fiscalHtml(enc('<CompNfse><Nfse><InfNfse><Numero>9</Numero><Servico><Discriminacao>Consultoria</Discriminacao><Valores><ValorServicos>100.00</ValorServicos></Valores></Servico></InfNfse></Nfse></CompNfse>'));
  assert.equal(abrasf.kind, 'nfse-abrasf');
  assert.match(abrasf.html, /Consultoria/);
  const other = await fiscalHtml(enc('<cteProc><CTe><infCte><ide><nCT>5</nCT></ide></infCte></CTe></cteProc>'));
  assert.equal(other.kind, 'generico');
  assert.match(other.html, /nCT/);
});

test('XML declared UTF-8 but saved as Latin-1 keeps its accents', () => {
  assert.equal(decodeXml(new Uint8Array([0x53, 0x65, 0x72, 0x76, 0x69, 0xe7, 0x6f])), 'Serviço');
});
