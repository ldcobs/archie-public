'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import type { ProtocolStatus } from '@/lib/inbounds';
import type { ManagedInbound } from '@/lib/inbound-config';
import { apiUrl } from '@/lib/api-path';
import { serverConfig } from '@/lib/server-config';
import { fetchJson } from '@/lib/fetch-json';
import { useI18n, type Lang } from '@/lib/i18n';

// Deployer-specific domain / SNI for the raw-JSON inbound templates (env-driven).
const DOMAIN = serverConfig.serverDomain;
const SNI = serverConfig.vlessSni;

type InboundsApiPayload = {
  ok: boolean;
  inbounds: ManagedInbound[];
  configPath?: string;
  writable?: boolean;
  error?: string;
};

const PRESETS = [
  {
    id: 'standard',
    label: { en: 'Standard', ru: 'Standard', es: 'Standard', pt: 'Standard' },
    desc: {
      en: 'Fastest default. Best for modern clients on normal networks.',
      ru: 'Самый быстрый базовый набор. Лучше всего для современных клиентов в обычных сетях.',
      es: 'El más rápido por defecto. Ideal para clientes modernos en redes normales.',
      pt: 'O padrão mais rápido. Ideal para clientes modernos em redes normais.',
    },
    protocols: ['vless-reality'],
  },
  {
    id: 'compatible',
    label: { en: 'Compatible', ru: 'Compatible', es: 'Compatible', pt: 'Compatível' },
    desc: {
      en: 'Adds fallback options for mixed or older client apps.',
      ru: 'Добавляет запасные варианты для смешанных или более старых клиентских приложений.',
      es: 'Agrega opciones de respaldo para apps de clientes mixtos o más antiguos.',
      pt: 'Adiciona opções de fallback para apps de clientes mistos ou mais antigos.',
    },
    protocols: ['vless-reality', 'vmess-ws-tls'],
  },
  {
    id: 'universal',
    label: { en: 'Universal', ru: 'Universal', es: 'Universal', pt: 'Universal' },
    desc: {
      en: 'Broadest coverage across client apps and network conditions.',
      ru: 'Максимально широкий охват по клиентам и условиям сети.',
      es: 'Mayor cobertura en apps de clientes y condiciones de red.',
      pt: 'Maior cobertura em apps de clientes e condições de rede.',
    },
    protocols: ['vless-reality', 'vmess-ws-tls', 'trojan-tls'],
  },
  {
    id: 'performance',
    label: { en: 'Performance', ru: 'Performance', es: 'Rendimiento', pt: 'Desempenho' },
    desc: {
      en: 'Optimized for speed and low latency on strong networks.',
      ru: 'Оптимизирован для скорости и низкой задержки в хороших сетях.',
      es: 'Optimizado para velocidad y baja latencia en redes estables.',
      pt: 'Otimizado para velocidade e baixa latência em redes estáveis.',
    },
    protocols: ['vless-reality', 'hysteria2', 'wireguard'],
  },
  {
    id: 'cdn-safe',
    label: { en: 'CDN Safe', ru: 'CDN Safe', es: 'CDN Safe', pt: 'CDN Safe' },
    desc: {
      en: 'Best for restrictive networks and CDN-routed traffic.',
      ru: 'Лучше всего подходит для ограниченных сетей и трафика через CDN.',
      es: 'Ideal para redes restrictivas y tráfico enrutado por CDN.',
      pt: 'Ideal para redes restritivas e tráfego roteado por CDN.',
    },
    protocols: ['vless-ws-tls', 'vless-grpc-tls'],
  },
  {
    id: 'legacy',
    label: { en: 'Legacy', ru: 'Legacy', es: 'Legacy', pt: 'Legacy' },
    desc: {
      en: 'For older apps and maximum backward compatibility.',
      ru: 'Для старых приложений и максимальной обратной совместимости.',
      es: 'Para apps antiguas y máxima compatibilidad retroactiva.',
      pt: 'Para apps antigas e máxima compatibilidade retroativa.',
    },
    protocols: ['vmess-ws-tls', 'vmess-grpc-tls', 'shadowsocks'],
  },
  {
    id: 'custom',
    label: { en: 'Custom', ru: 'Custom', es: 'Custom', pt: 'Custom' },
    desc: {
      en: 'Manually select protocols for a one-off bundle.',
      ru: 'Выберите протоколы вручную для своего набора.',
      es: 'Selecciona manualmente los protocolos para un conjunto personalizado.',
      pt: 'Selecione manualmente os protocolos para um conjunto personalizado.',
    },
    protocols: [] as readonly string[],
  },
] as const;

function arraysEqual(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function buildTemplate(protocolKey: string) {
  const base = protocolKey.replace(/[^a-z0-9-]/gi, '-');
  const templates: Record<string, Record<string, unknown>> = {
    'vless-reality': {
      tag: base,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          dest: `${SNI}:443`,
          serverNames: [SNI],
          privateKey: 'REPLACE_ME',
          shortIds: ['REPLACE_ME'],
        },
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    },
    'vless-ws-tls': {
      tag: base,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/vless-ws', headers: { Host: DOMAIN } },
      },
    },
    'vless-grpc-tls': {
      tag: base,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'grpc',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        grpcSettings: { serviceName: 'vless-grpc' },
      },
    },
    'vmess-ws-tls': {
      tag: base,
      port: 443,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/vmess-ws', headers: { Host: DOMAIN } },
      },
    },
    'vmess-grpc-tls': {
      tag: base,
      port: 443,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'grpc',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        grpcSettings: { serviceName: 'vmess-grpc' },
      },
    },
    'trojan-tls': {
      tag: base,
      port: 2053,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: DOMAIN } },
    },
    'trojan-ws-tls': {
      tag: base,
      port: 443,
      protocol: 'trojan',
      settings: { clients: [] },
      streamSettings: {
        network: 'ws',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        wsSettings: { path: '/trojan-ws', headers: { Host: DOMAIN } },
      },
    },
    shadowsocks: {
      tag: base,
      port: 8388,
      protocol: 'shadowsocks',
      settings: { method: 'chacha20-ietf-poly1305', password: 'REPLACE_ME', network: 'tcp,udp' },
    },
    'vless-xhttp-tls': {
      tag: base,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'xhttp',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        xhttpSettings: { path: '/vless-xhttp', host: DOMAIN },
      },
    },
    'vmess-xhttp-tls': {
      tag: base,
      port: 443,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'xhttp',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        xhttpSettings: { path: '/vmess-xhttp', host: DOMAIN },
      },
    },
    'vless-httpupgrade': {
      tag: base,
      port: 443,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: {
        network: 'httpupgrade',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        httpupgradeSettings: { path: '/vless-hu', host: DOMAIN },
      },
    },
    'vmess-httpupgrade': {
      tag: base,
      port: 443,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: {
        network: 'httpupgrade',
        security: 'tls',
        tlsSettings: { serverName: DOMAIN },
        httpupgradeSettings: { path: '/vmess-hu', host: DOMAIN },
      },
    },
    'vless-mkcp': {
      tag: base,
      port: 4500,
      protocol: 'vless',
      settings: { clients: [], decryption: 'none' },
      streamSettings: { network: 'kcp', security: 'none', kcpSettings: { header: { type: 'none' } } },
    },
    'vmess-mkcp': {
      tag: base,
      port: 4500,
      protocol: 'vmess',
      settings: { clients: [] },
      streamSettings: { network: 'kcp', security: 'none', kcpSettings: { header: { type: 'none' } } },
    },
    http: { tag: base, port: 8080, protocol: 'http', settings: { timeout: 300 } },
    socks: { tag: base, port: 1080, protocol: 'socks', settings: { auth: 'noauth', udp: true } },
    dokodemo: { tag: base, port: 12345, protocol: 'dokodemo-door', settings: { address: '1.1.1.1', port: 443, network: 'tcp,udp' } },
  };
  return templates[protocolKey] ?? { tag: base, port: 443, protocol: 'vless', settings: {} };
}

function text(lang: Lang) {
  const r = lang === 'ru', es = lang === 'es', pt = lang === 'pt';
  return {
    title: r ? 'Серверные входы' : es ? 'Entradas del servidor' : pt ? 'Entradas do servidor' : 'Server Inbounds',
    summary: (count: number, live: number, clients: number) => r
      ? `${count} протоколов · ${live} активны · ${clients} назначений клиентам`
      : es ? `${count} protocolos · ${live} activos · ${clients} asignaciones`
      : pt ? `${count} protocolos · ${live} ativos · ${clients} atribuições`
      : `${count} protocols · ${live} live · ${clients} client assignments`,
    configLive: r ? 'КОНФИГ ЧИТАЕТСЯ' : es ? 'CONFIGURACIÓN ACTIVA' : pt ? 'CONFIGURAÇÃO ATIVA' : 'CONFIG LIVE',
    configUnreadable: r ? 'КОНФИГ НЕДОСТУПЕН' : es ? 'CONFIGURACIÓN INACCESIBLE' : pt ? 'CONFIGURAÇÃO INACESSÍVEL' : 'CONFIG UNREADABLE',
    testConfig: r ? '◇ Проверить конфиг' : es ? '◇ Probar config' : pt ? '◇ Testar config' : '◇ Test Config',
    testing: r ? 'Проверка…' : es ? 'Probando…' : pt ? 'Testando…' : 'Testing…',
    restart: r ? '↻ Перезапустить Xray' : es ? '↻ Reiniciar Xray' : pt ? '↻ Reiniciar Xray' : '↻ Restart Xray',
    restarting: r ? 'Перезапуск…' : es ? 'Reiniciando…' : pt ? 'Reiniciando…' : 'Restarting…',
    confirmRestart: r ? 'Перезапустить Xray? Сначала будет проверен конфиг, затем выполнится автооткат при плохом health-check.' : es ? 'Reiniciar Xray? Primero se verifica el config, luego reinicia con auto-rollback si falla el health-check.' : pt ? 'Reiniciar Xray? Testa o config primeiro, depois reinicia com auto-rollback se falhar no health-check.' : 'Restart Xray? Tests the config first, then restarts with auto-rollback if unhealthy.',
    localOnlyAction: r ? 'Python API недоступен. Это действие работает только на VPS через /v3/vpn-api/, а не в local dev.' : es ? 'Python API no disponible. Esta acción se ejecuta en el VPS (vía /v3/vpn-api/) — no disponible en local dev.' : pt ? 'Python API indisponível. Esta ação roda no VPS (via /v3/vpn-api/) — não disponível em local dev.' : 'Python API not reachable. This action runs on the VPS (via the /v3/vpn-api/ proxy) — not available in local dev.',
    configPassed: r ? '✓ Конфиг валиден — xray run -test прошёл' : es ? '✓ Config válido — xray run -test pasó' : pt ? '✓ Config válido — xray run -test passou' : '✓ Config valid — xray run -test passed',
    configFailed: r ? '✗ Проверка конфига не прошла' : es ? '✗ Verificación del config falló' : pt ? '✗ Verificação do config falhou' : '✗ Config test failed',
    restartedHealthy: (backup?: string) => r
      ? `✓ Xray перезапущен и healthy${backup ? ` (backup: ${backup})` : ''}`
      : es ? `✓ Xray reiniciado y healthy${backup ? ` (backup: ${backup})` : ''}`
      : pt ? `✓ Xray reiniciado e healthy${backup ? ` (backup: ${backup})` : ''}`
      : `✓ Xray restarted and healthy${backup ? ` (backup: ${backup})` : ''}`,
    rolledBack: r ? '⚠ Перезапуск не прошёл health-check — выполнен откат к прошлому конфигу' : es ? '⚠ Reinicio falló health-check — revertido al config anterior' : pt ? '⚠ Reinício falhou no health-check — revertido ao config anterior' : '⚠ Restart failed health check — rolled back to previous config',
    keyNameError: r ? 'Введите имя ключа' : es ? 'Ingresa el nombre de la clave' : pt ? 'Digite o nome da chave' : 'Enter a key name',
    keyCreated: (email: string) => r ? `✓ Ключ создан: ${email} — активируется в течение 60 секунд` : es ? `✓ Clave creada: ${email} — activa en 60 segundos` : pt ? `✓ Chave criada: ${email} — ativa em 60 segundos` : `✓ Key created: ${email} — active within 60s`,
    catalog: r ? 'Каталог протоколов' : es ? 'Catálogo de protocolos' : pt ? 'Catálogo de protocolos' : 'Protocol Catalog',
    selectHint: r ? 'Выберите протоколы для генерируемого ключа' : es ? 'Selecciona los protocolos para incluir en la clave generada' : pt ? 'Selecione os protocolos para incluir na chave gerada' : 'Select protocols to include in the generated key',
    live: r ? 'Активен' : es ? 'Activo' : pt ? 'Ativo' : 'Live',
    off: r ? 'Выкл' : es ? 'Apagado' : pt ? 'Desligado' : 'Off',
    client: r ? 'клиент' : 'client',
    clients: r ? 'клиентов' : 'clientes',
    docs: r ? 'Документация ↗' : 'Docs ↗',
    separateService: r ? 'Отдельный сервис' : es ? 'Servicio independiente' : pt ? 'Serviço independente' : 'Separate Service',
    addToKey: r ? 'Добавить в ключ' : es ? 'Agregar a la clave' : pt ? 'Adicionar à chave' : 'Add to key',
    removeFromKey: r ? 'Убрать из ключа' : es ? 'Quitar de la clave' : pt ? 'Remover da chave' : 'Remove from key',
    standaloneTitle: (name: string) => r ? `${name} работает как отдельный сервис, не как inbound Xray` : es ? `${name} funciona como servicio independiente (no como inbound Xray)` : pt ? `${name} funciona como serviço independente (não como inbound Xray)` : `${name} runs as a separate service (not an Xray inbound)`,
    generator: r ? '＋ Сгенерировать ключ' : es ? '＋ Generar clave' : pt ? '＋ Gerar chave' : '＋ Generate Key',
    generatorHint: r ? 'Нажимайте протоколы слева или начните с готового пресета.' : es ? 'Haz clic en los protocolos de la izquierda o empieza con un preset.' : pt ? 'Clique nos protocolos à esquerda ou comece com um preset.' : 'Click protocols on the left, or start from a curated preset.',
    keyPlaceholder: r ? 'Имя ключа (строчные, без пробелов)' : es ? 'Nombre de la clave (minúsculas, sin espacios)' : pt ? 'Nome da chave (minúsculas, sem espaços)' : 'Key name (lowercase, no spaces)',
    displayPlaceholder: r ? 'Отображаемое имя (необязательно)' : es ? 'Nombre de visualización (opcional)' : pt ? 'Nome de exibição (opcional)' : 'Display name (optional)',
    noGroups: r ? 'Групп пока нет' : es ? 'Aún no hay grupos' : pt ? 'Ainda não há grupos' : 'No groups yet',
    newGroup: r ? '+ Новая группа…' : es ? '+ Nuevo grupo…' : pt ? '+ Novo grupo…' : '+ New group…',
    newGroupPlaceholder: r ? 'Название новой группы' : es ? 'Nombre del nuevo grupo' : pt ? 'Nome do novo grupo' : 'New group name',
    selected: (n: number) => r ? `Выбрано (${n})` : es ? `Seleccionados (${n})` : pt ? `Selecionados (${n})` : `Selected (${n})`,
    selectAtLeastOne: r ? 'Выберите хотя бы один протокол →' : es ? 'Selecciona al menos un protocolo →' : pt ? 'Selecione pelo menos um protocolo →' : 'Select at least one protocol →',
    create: r ? 'Создать…' : es ? 'Creando…' : pt ? 'Criando…' : 'Creating…',
    generate: r ? '＋ Сгенерировать ключ' : es ? '＋ Generar clave' : pt ? '＋ Gerar chave' : '＋ Generate Key',
    presets: r ? 'Пресеты' : es ? 'Preajustes' : pt ? 'Presets' : 'Presets',
    presetsHint: r ? 'Готовые наборы для типичных сценариев. Custom оставляет выбор полностью за вами.' : es ? 'Conjuntos curados para casos de uso comunes. Custom deja la mezcla de protocolos completamente a tu criterio.' : pt ? 'Conjuntos curados para casos de uso comuns. Custom deixa a mistura de protocolos totalmente a seu critério.' : 'Curated bundles for common use cases. Custom leaves the protocol mix entirely up to you.',
    mgmt: r ? 'Управление входами' : es ? 'Gestión de entradas' : pt ? 'Gestão de entradas' : 'Inbound Management',
    mgmtHint: r ? 'Локальный CRUD для inbound-конфига Xray. Изменения ставятся в очередь на перезапуск.' : es ? 'CRUD local para el config de inbound de Xray. Los cambios programan un reinicio.' : pt ? 'CRUD local para o config de inbound do Xray. As alterações agendam um reinício.' : 'Local-first CRUD for Xray inbound config. Saves queue a restart request.',
    mgmtShow: r ? 'Показать' : es ? 'Mostrar' : pt ? 'Mostrar' : 'Show',
    mgmtHide: r ? 'Скрыть' : es ? 'Ocultar' : pt ? 'Ocultar' : 'Hide',
    createInbound: r ? '+ Новый inbound' : es ? '+ Nueva entrada' : pt ? '+ Nova entrada' : '+ New inbound',
    configPath: r ? 'Путь конфига' : es ? 'Ruta del config' : pt ? 'Caminho do config' : 'Config path',
    writable: r ? 'доступно для записи' : es ? 'con escritura' : pt ? 'gravável' : 'writable',
    readOnly: r ? 'только чтение' : es ? 'solo lectura' : pt ? 'somente leitura' : 'read only',
    inventoryEmpty: r ? 'Inbound-ы пока не найдены.' : es ? 'No se encontraron entradas todavía.' : pt ? 'Nenhuma entrada encontrada ainda.' : 'No inbounds found yet.',
    tag: 'Tag',
    protocol: r ? 'Протокол' : es ? 'Protocolo' : pt ? 'Protocolo' : 'Protocol',
    port: r ? 'Порт' : es ? 'Puerto' : pt ? 'Porta' : 'Port',
    transport: r ? 'Транспорт' : es ? 'Transporte' : pt ? 'Transporte' : 'Transport',
    actions: r ? 'Действия' : es ? 'Acciones' : pt ? 'Ações' : 'Actions',
    edit: r ? 'Изменить' : es ? 'Editar' : pt ? 'Editar' : 'Edit',
    remove: r ? 'Удалить' : es ? 'Eliminar' : pt ? 'Excluir' : 'Delete',
    protected: r ? 'Системный' : es ? 'Sistema' : pt ? 'Sistema' : 'System',
    editorCreate: r ? 'Создать inbound' : es ? 'Crear entrada' : pt ? 'Criar entrada' : 'Create inbound',
    editorEdit: r ? 'Редактировать inbound' : es ? 'Editar entrada' : pt ? 'Editar entrada' : 'Edit inbound',
    template: r ? 'Шаблон' : es ? 'Plantilla' : pt ? 'Modelo' : 'Template',
    rawJson: 'Raw JSON',
    save: r ? 'Сохранить' : es ? 'Guardar' : pt ? 'Salvar' : 'Save',
    saving: r ? 'Сохранение…' : es ? 'Guardando…' : pt ? 'Salvando…' : 'Saving…',
    createSave: r ? 'Создать inbound' : es ? 'Crear entrada' : pt ? 'Criar entrada' : 'Create inbound',
    deleteConfirm: r ? 'Удалить этот inbound? Если клиенты ещё назначены, операция будет отклонена.' : es ? 'Eliminar esta entrada? Si hay clientes asignados, la operación será rechazada.' : pt ? 'Excluir esta entrada? Se houver clientes atribuídos, a operação será rejeitada.' : 'Delete this inbound? If clients are still assigned, the operation will be rejected.',
    selectProtocol: r ? 'Выберите протокол для старта, затем отредактируйте JSON ниже.' : es ? 'Elige un protocolo de inicio, luego ajusta el JSON abajo.' : pt ? 'Escolha um protocolo de início, depois ajuste o JSON abaixo.' : 'Choose a protocol starter, then refine the JSON below.',
    close: r ? 'Закрыть' : es ? 'Cerrar' : pt ? 'Fechar' : 'Close',
    validationError: r ? 'JSON невалиден' : es ? 'JSON no válido' : pt ? 'JSON inválido' : 'Invalid JSON',
    quickSettings: r ? 'Быстрые настройки' : es ? 'Ajustes rápidos' : pt ? 'Ajustes rápidos' : 'Quick Settings',
    quickHint: r ? 'Эти поля синхронизируются с JSON ниже. Для остального правьте JSON.' : es ? 'Estos campos se sincronizan con el JSON de abajo. Para lo demás, edita el JSON.' : pt ? 'Estes campos sincronizam com o JSON abaixo. Para o resto, edite o JSON.' : 'These fields sync into the JSON below. Edit the JSON for anything else.',
    quickInvalid: r ? 'Исправьте JSON, чтобы использовать быстрые поля.' : es ? 'Corrige el JSON para usar los campos rápidos.' : pt ? 'Corrija o JSON para usar os campos rápidos.' : 'Fix the JSON to use the quick fields.',
    fPort: r ? 'Порт' : es ? 'Puerto' : pt ? 'Porta' : 'Port',
    fSni: 'SNI / serverName',
    fSniHint: r ? 'Reality: подставной домен (например www.cloudflare.com). TLS-протоколы (WS/gRPC/Trojan — через Cloudflare или прямой сертификат): ваш реальный домен.' : es ? 'Reality: dominio señuelo (p. ej. www.cloudflare.com). Protocolos TLS (WS/gRPC/Trojan — vía Cloudflare o certificado directo): tu dominio real.' : pt ? 'Reality: domínio isca (ex. www.cloudflare.com). Protocolos TLS (WS/gRPC/Trojan — via Cloudflare ou certificado direto): seu domínio real.' : 'Reality: decoy domain (e.g. www.cloudflare.com). TLS protocols (WS/gRPC/Trojan — via Cloudflare or a direct cert): your real domain.',
    fHost: r ? 'CDN Host (заголовок)' : es ? 'CDN Host (cabecera)' : pt ? 'CDN Host (cabeçalho)' : 'CDN Host (header)',
    fPath: r ? 'Путь / serviceName' : es ? 'Ruta / serviceName' : pt ? 'Caminho / serviceName' : 'Path / serviceName',
  };
}

// ── Quick-field <-> JSON bridge (3x-ui style form over the raw inbound JSON) ───
type QuickField = 'port' | 'sni' | 'host' | 'path';
interface InboundDraft {
  port?: number | string;
  streamSettings?: {
    realitySettings?: { serverNames?: string[]; dest?: string };
    tlsSettings?: { serverName?: string };
    wsSettings?: { path?: string; headers?: { Host?: string } };
    xhttpSettings?: { path?: string; host?: string };
    httpupgradeSettings?: { path?: string; host?: string };
    grpcSettings?: { serviceName?: string };
  };
}
function quickFieldsPresent(o: InboundDraft): QuickField[] {
  const s = o?.streamSettings ?? {};
  const out: QuickField[] = [];
  if (o?.port !== undefined) out.push('port');
  if (s.realitySettings || s.tlsSettings) out.push('sni');
  if (s.wsSettings || s.xhttpSettings || s.httpupgradeSettings) out.push('host');
  if (s.wsSettings || s.xhttpSettings || s.httpupgradeSettings || s.grpcSettings) out.push('path');
  return out;
}
function readQuickField(o: InboundDraft, f: QuickField): string {
  const s = o?.streamSettings ?? {};
  switch (f) {
    case 'port': return String(o?.port ?? '');
    case 'sni':  return s.realitySettings?.serverNames?.[0] ?? s.tlsSettings?.serverName ?? '';
    case 'host': return s.wsSettings?.headers?.Host ?? s.xhttpSettings?.host ?? s.httpupgradeSettings?.host ?? '';
    case 'path': return s.wsSettings?.path ?? s.xhttpSettings?.path ?? s.httpupgradeSettings?.path ?? s.grpcSettings?.serviceName ?? '';
  }
}
function writeQuickField(o: InboundDraft, f: QuickField, v: string): void {
  const s = o.streamSettings ?? {};
  switch (f) {
    case 'port': o.port = /^\d+$/.test(v) ? Number(v) : v; break;
    case 'sni':
      if (s.realitySettings) {
        s.realitySettings.serverNames = [v];
        const dest = s.realitySettings.dest ?? '';
        const port = dest.includes(':') ? dest.split(':').pop() : '443';
        s.realitySettings.dest = `${v}:${port}`;
      }
      if (s.tlsSettings) s.tlsSettings.serverName = v;
      break;
    case 'host':
      if (s.wsSettings) s.wsSettings.headers = { ...(s.wsSettings.headers ?? {}), Host: v };
      if (s.xhttpSettings) s.xhttpSettings.host = v;
      if (s.httpupgradeSettings) s.httpupgradeSettings.host = v;
      break;
    case 'path':
      if (s.wsSettings) s.wsSettings.path = v;
      if (s.xhttpSettings) s.xhttpSettings.path = v;
      if (s.httpupgradeSettings) s.httpupgradeSettings.path = v;
      if (s.grpcSettings) s.grpcSettings.serviceName = v;
      break;
  }
}

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
      {(['en', 'ru', 'es', 'pt'] as const).map(choice => (
        <button
          key={choice}
          onClick={() => setLang(choice)}
          style={{
            background: lang === choice ? 'var(--accent)' : 'transparent',
            color: lang === choice ? 'var(--bg)' : 'var(--text-dim)',
            border: 'none',
            padding: '5px 9px',
            fontFamily: 'inherit',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {choice.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export default function ProtocolCatalogClient({
  status,
  groups,
  configReadable,
  initialInbounds,
  configPath,
  configWritable,
}: {
  status: ProtocolStatus[];
  groups: string[];
  configReadable: boolean;
  initialInbounds: ManagedInbound[];
  configPath: string;
  configWritable: boolean;
}) {
  const { lang, setLang } = useI18n();
  const copy = text(lang);
  const liveCount = status.filter(s => s.live).length;
  const totalClients = status.reduce((sum, s) => sum + s.clientCount, 0);

  const [email, setEmail] = useState('');
  const [display, setDisplay] = useState('');
  const [group, setGroup] = useState(groups[0] ?? '');
  const [customGroup, setCustomGroup] = useState('');
  const [protocols, setProtocols] = useState<string[]>(['vless-reality']);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [testing, setTesting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string; detail?: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; inbound?: ManagedInbound; protocolKey: string } | null>(null);
  const [draftText, setDraftText] = useState('');
  const [savingInbound, setSavingInbound] = useState(false);
  const [inboundMessage, setInboundMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);

  const { data: inventoryData, mutate: mutateInbounds } = useSWR<InboundsApiPayload>(
    apiUrl('/api/inbounds'),
    fetchJson,
    {
      fallbackData: { ok: true, inbounds: initialInbounds, configPath, writable: configWritable },
      refreshInterval: 15_000,
      dedupingInterval: 1_000,
    },
  );

  const inbounds = inventoryData?.inbounds ?? [];
  const effectiveConfigPath = inventoryData?.configPath ?? configPath;
  const effectiveWritable = inventoryData?.writable ?? configWritable;

  function openCreate(protocolKey = 'shadowsocks') {
    setEditor({ mode: 'create', protocolKey });
    setDraftText(JSON.stringify(buildTemplate(protocolKey), null, 2));
    setInboundMessage(null);
  }

  function openEdit(inbound: ManagedInbound) {
    const protocolKey = status.find((item) => item.entry.name === inbound.protocol)?.entry.key ?? 'shadowsocks';
    setEditor({ mode: 'edit', inbound, protocolKey });
    setDraftText(JSON.stringify(inbound.raw, null, 2));
    setInboundMessage(null);
  }

  function updateDraftProtocol(protocolKey: string) {
    setEditor((prev) => prev ? { ...prev, protocolKey } : prev);
    if (editor?.mode === 'create') {
      setDraftText(JSON.stringify(buildTemplate(protocolKey), null, 2));
    }
  }

  // Parse the draft once so the quick fields can read/write it; null = invalid JSON
  const parsedDraft = useMemo<InboundDraft | null>(() => {
    try { return JSON.parse(draftText) as InboundDraft; } catch { return null; }
  }, [draftText]);
  const quickFields = parsedDraft ? quickFieldsPresent(parsedDraft) : [];
  function updateQuickField(f: QuickField, v: string) {
    if (!parsedDraft) return;
    const clone = JSON.parse(JSON.stringify(parsedDraft)) as InboundDraft;
    writeQuickField(clone, f, v);
    setDraftText(JSON.stringify(clone, null, 2));
  }

  function vpnApiUrl(path: string): string {
    return `${apiUrl(path)}`;
  }

  async function vpnApi(path: string): Promise<{ ok: boolean; output?: string; reason?: string; healthy?: boolean; rolled_back?: boolean; backup?: string; test_output?: string } | null> {
    let r: Response;
    try {
      r = await fetch(vpnApiUrl(path), { method: 'POST' });
    } catch {
      return null;
    }
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      return null;
    }
    return r.json();
  }

  function toggleProtocol(key: string) {
    setProtocols(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  }

  async function testConfig() {
    setTesting(true); setActionResult(null);
    const d = await vpnApi('/api/vpn-proxy/vpn-api/inbounds/test');
    if (d === null) {
      setActionResult({ ok: false, text: copy.localOnlyAction }); setDetailOpen(true);
    } else {
      setActionResult({ ok: d.ok, text: d.ok ? copy.configPassed : copy.configFailed, detail: d.output });
      setDetailOpen(!d.ok);
    }
    setTesting(false);
  }

  async function restart() {
    if (!confirm(copy.confirmRestart)) return;
    setRestarting(true); setActionResult(null);
    const d = await vpnApi('/api/vpn-proxy/vpn-api/inbounds/restart');
    if (d === null) {
      setActionResult({ ok: false, text: copy.localOnlyAction });
    } else if (d.ok && d.healthy) {
      setActionResult({ ok: true, text: copy.restartedHealthy(d.backup) });
    } else if (d.rolled_back) {
      setActionResult({ ok: false, text: copy.rolledBack, detail: d.test_output });
    } else {
      setActionResult({ ok: false, text: d.reason ?? copy.rolledBack, detail: d.test_output });
    }
    setRestarting(false);
  }

  const chosenGroup = group === '__new__' ? customGroup : group;

  async function create() {
    if (!email) { setResult({ ok: false, text: copy.keyNameError }); return; }
    setCreating(true); setResult(null);
    try {
      const r = await fetch(apiUrl('/api/users'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName: display || email, group: chosenGroup, protocols }),
      });
      const d = await r.json();
      if (!r.ok) setResult({ ok: false, text: d.error ?? 'Failed' });
      else {
        setResult({ ok: true, text: copy.keyCreated(d.email) });
        setEmail('');
        setDisplay('');
        setProtocols(['vless-reality']);
      }
    } catch (e) {
      setResult({ ok: false, text: String(e) });
    }
    setCreating(false);
  }

  async function saveInbound() {
    if (!editor) return;
    let inbound: Record<string, unknown>;
    try {
      inbound = JSON.parse(draftText) as Record<string, unknown>;
    } catch {
      setInboundMessage({ ok: false, text: copy.validationError });
      return;
    }

    setSavingInbound(true);
    setInboundMessage(null);
    try {
      const url = editor.mode === 'create'
        ? apiUrl('/api/inbounds')
        : apiUrl(`/api/inbounds/${editor.inbound?.index}`);
      const method = editor.mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbound }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setInboundMessage({ ok: false, text: payload.error ?? 'Save failed' });
      } else {
        setInboundMessage({ ok: true, text: editor.mode === 'create' ? 'Inbound created.' : 'Inbound updated.' });
        await mutateInbounds();
        if (editor.mode === 'create') {
          setEditor(null);
          setDraftText('');
        }
      }
    } catch (err) {
      setInboundMessage({ ok: false, text: String(err) });
    } finally {
      setSavingInbound(false);
    }
  }

  async function removeInbound(inbound: ManagedInbound) {
    if (!confirm(copy.deleteConfirm)) return;
    setInboundMessage(null);
    try {
      const res = await fetch(apiUrl(`/api/inbounds/${inbound.index}`), { method: 'DELETE' });
      const payload = await res.json();
      if (!res.ok) {
        setInboundMessage({ ok: false, text: payload.error ?? 'Delete failed' });
      } else {
        setInboundMessage({ ok: true, text: 'Inbound deleted.' });
        await mutateInbounds();
        if (editor?.mode === 'edit' && editor.inbound?.index === inbound.index) {
          setEditor(null);
          setDraftText('');
        }
      }
    } catch (err) {
      setInboundMessage({ ok: false, text: String(err) });
    }
  }

  const selectedSet = new Set(protocols);
  const createableStatus = useMemo(
    () => status.filter((item) => item.entry.engine === 'xray'),
    [status],
  );

  return (
    <div style={{ padding: '22px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2.5, color: 'var(--accent)', textTransform: 'uppercase' }}>{copy.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
            {copy.summary(status.length, liveCount, totalClients)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <LangToggle lang={lang} setLang={setLang} />
          <div style={{ fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '4px 10px', color: configReadable ? 'var(--green)' : 'var(--red)', background: configReadable ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${configReadable ? 'rgba(34,200,100,0.2)' : 'rgba(220,80,80,0.2)'}` }}>
            {configReadable ? copy.configLive : copy.configUnreadable}
          </div>
          <button onClick={testConfig} disabled={testing} style={{ background: 'transparent', color: testing ? 'var(--accent-dim)' : 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: testing ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {testing ? copy.testing : copy.testConfig}
          </button>
          <button onClick={restart} disabled={restarting} style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,77,90,0.4)', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: restarting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {restarting ? copy.restarting : copy.restart}
          </button>
        </div>
      </div>

      {actionResult && (
        <div style={{ fontSize: 11, borderRadius: 7, marginBottom: 18, background: actionResult.ok ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${actionResult.ok ? 'rgba(34,230,107,.25)' : 'rgba(255,77,90,.25)'}`, overflow: 'hidden' }}>
          <div
            onClick={() => actionResult.detail && setDetailOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', color: actionResult.ok ? 'var(--green)' : 'var(--red)', cursor: actionResult.detail ? 'pointer' : 'default' }}
          >
            <span>{actionResult.text}</span>
            {actionResult.detail && (
              <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 10 }}>{detailOpen ? '▲ hide' : '▼ details'}</span>
            )}
          </div>
          {actionResult.detail && detailOpen && (
            <pre style={{ margin: 0, padding: '0 14px 12px', fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 200, overflow: 'auto', borderTop: '1px solid var(--border-subtle)' }}>{actionResult.detail}</pre>
          )}
        </div>
      )}

      <div style={{ marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>{copy.mgmt}</div>
            <div style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-dim)', maxWidth: 760 }}>{copy.mgmtHint}</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 8 }}>
              {copy.configPath}: <span style={{ color: 'var(--text-bright)' }}>{effectiveConfigPath}</span> · {effectiveWritable ? copy.writable : copy.readOnly}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setManagementOpen((open) => !open)}
              style={{ background: 'transparent', color: 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {managementOpen ? copy.mgmtHide : copy.mgmtShow}
            </button>
            {managementOpen && (
              <button
                type="button"
                onClick={() => openCreate('shadowsocks')}
                style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {copy.createInbound}
              </button>
            )}
          </div>
        </div>

        {managementOpen && inboundMessage && (
          <div style={{ margin: '14px 20px 0', fontSize: 11, padding: '9px 12px', borderRadius: 7, background: inboundMessage.ok ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${inboundMessage.ok ? 'rgba(34,230,107,.22)' : 'rgba(255,77,90,.22)'}`, color: inboundMessage.ok ? 'var(--green)' : 'var(--red)' }}>
            {inboundMessage.text}
          </div>
        )}

        {managementOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: editor ? 'minmax(0, 1.6fr) minmax(360px, 0.9fr)' : '1fr', gap: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              {inbounds.length === 0 ? (
                <div style={{ padding: '24px 20px', fontSize: 11, color: 'var(--text-dim)' }}>{copy.inventoryEmpty}</div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr 0.6fr 0.9fr 0.55fr 0.8fr', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', fontSize: 9.5, fontWeight: 800, letterSpacing: 1.4, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    <div>{copy.tag}</div>
                    <div>{copy.protocol}</div>
                    <div>{copy.port}</div>
                    <div>{copy.transport}</div>
                    <div>{copy.clients}</div>
                    <div>{copy.actions}</div>
                  </div>
                  {inbounds.map((inbound) => (
                    <div key={`${inbound.index}-${inbound.tag || inbound.protocol}`} style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.9fr 0.6fr 0.9fr 0.55fr 0.8fr', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-bright)' }}>{inbound.tag || '—'}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>{inbound.listen}</div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-bright)' }}>{inbound.protocol}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-bright)' }}>{inbound.port ?? '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{inbound.transport}</div>
                      <div style={{ fontSize: 11, color: inbound.clientCount > 0 ? 'var(--green)' : 'var(--text-dim)' }}>{inbound.clientCount}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => openEdit(inbound)} style={{ background: 'transparent', color: 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {copy.edit}
                        </button>
                        <button onClick={() => removeInbound(inbound)} disabled={inbound.protected} style={{ background: 'transparent', color: inbound.protected ? 'var(--text-faint)' : 'var(--red)', border: `1px solid ${inbound.protected ? 'var(--border-subtle)' : 'rgba(255,77,90,0.35)'}`, borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: inbound.protected ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                          {inbound.protected ? copy.protected : copy.remove}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {editor && (
              <div style={{ borderLeft: '1px solid var(--border-subtle)', padding: '18px 18px 20px', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-bright)' }}>
                    {editor.mode === 'create' ? copy.editorCreate : copy.editorEdit}
                  </div>
                  <button onClick={() => { setEditor(null); setDraftText(''); }} style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {copy.close}
                  </button>
                </div>

                {editor.mode === 'create' && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>{copy.template}</div>
                    <select value={editor.protocolKey} onChange={(e) => updateDraftProtocol(e.target.value)} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 13px', color: 'var(--text-bright)', fontSize: 13 }}>
                      {createableStatus.map((item) => (
                        <option key={item.entry.key} value={item.entry.key}>{item.entry.name}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--text-dim)', marginTop: 8 }}>{copy.selectProtocol}</div>
                  </div>
                )}

                {/* Quick fields — 3x-ui style form over the raw JSON */}
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>{copy.quickSettings}</div>
                {parsedDraft ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 9, marginBottom: 8 }}>
                      {quickFields.map((f) => {
                        const label = f === 'port' ? copy.fPort : f === 'sni' ? copy.fSni : f === 'host' ? copy.fHost : copy.fPath;
                        return (
                          <div key={f}>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
                            <input
                              value={readQuickField(parsedDraft, f)}
                              onChange={(e) => updateQuickField(f, e.target.value)}
                              inputMode={f === 'port' ? 'numeric' : 'text'}
                              spellCheck={false}
                              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 10px', color: 'var(--text-bright)', fontSize: 12, outline: 'none', fontFamily: f === 'port' ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                            />
                            {f === 'sni' && (
                              <div style={{ fontSize: 9, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 4 }}>{copy.fSniHint}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 9.5, lineHeight: 1.45, color: 'var(--text-faint)', marginBottom: 14 }}>{copy.quickHint}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--amber)', marginBottom: 14 }}>{copy.quickInvalid}</div>
                )}

                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>{copy.rawJson}</div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  spellCheck={false}
                  style={{ width: '100%', minHeight: 420, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 13px', color: 'var(--text-bright)', fontSize: 12, lineHeight: 1.55, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                />

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={saveInbound} disabled={savingInbound} style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: savingInbound ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {savingInbound ? copy.saving : (editor.mode === 'create' ? copy.createSave : copy.save)}
                  </button>
                  {editor.mode === 'edit' && editor.inbound && (
                    <button onClick={() => {
                      const currentInbound = editor.inbound;
                      if (currentInbound) void removeInbound(currentInbound);
                    }} style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,77,90,0.3)', borderRadius: 8, padding: '9px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {copy.remove}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 18, alignItems: 'start' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>{copy.catalog}</span>
            <span style={{ fontWeight: 600, letterSpacing: 0.4, textTransform: 'none', color: 'var(--text-faint)' }}>{copy.selectHint}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9 }}>
            {status.map(({ entry, live, port, clientCount }) => {
              const c = entry.color;
              const selected = selectedSet.has(entry.key);
              const standalone = entry.engine !== 'xray';
              const clientText = clientCount > 0
                ? `${clientCount} ${clientCount === 1 ? copy.client : copy.clients}`
                : '';
              return (
                <div
                  key={entry.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleProtocol(entry.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleProtocol(entry.key);
                    }
                  }}
                  title={selected ? copy.removeFromKey : standalone ? copy.standaloneTitle(entry.name) : copy.addToKey}
                  style={{
                    textAlign: 'left', cursor: 'pointer', background: 'var(--surface)',
                    border: `1px solid ${selected ? c : live ? `${c}40` : 'var(--border-subtle)'}`,
                    boxShadow: selected ? `0 0 0 1px ${c}, 0 0 10px ${c}2a` : 'none',
                    borderRadius: 9, padding: '11px 12px', fontFamily: 'inherit', color: 'inherit',
                    transition: 'box-shadow 0.12s, border-color 0.12s', minHeight: 154, display: 'flex', flexDirection: 'column', gap: 0,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1.1 }}>{entry.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {standalone && (
                        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.7, color: 'var(--green)', textTransform: 'uppercase', padding: '2px 5px', borderRadius: 999, border: '1px solid rgba(0,196,160,0.24)', background: 'var(--green-dim)' }} title={copy.standaloneTitle(entry.name)}>
                          {copy.separateService}
                        </span>
                      )}
                      {selected && <span style={{ fontSize: 13, color: c, fontWeight: 800 }}>✓</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: c, fontWeight: 700, marginBottom: 2 }}>{entry.transport}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginBottom: 7, lineHeight: 1.32 }}>{entry.desc}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {entry.badges.map(b => (
                      <span key={b} style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${c}1a`, color: c, letterSpacing: 0.25, lineHeight: 1.45 }}>{b}</span>
                    ))}
                  </div>
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingTop: 7, borderTop: `1px ${standalone ? 'dashed' : 'solid'} var(--border-subtle)` }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'monospace', fontSize: 10, color: live ? 'var(--text-bright)' : 'var(--text-faint)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: live ? c : 'var(--text-faint)', boxShadow: live ? `0 0 5px ${c}` : 'none', flexShrink: 0 }} />
                      {live ? copy.live : copy.off} · :{port}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                      <span style={{ fontSize: 10, color: clientCount > 0 ? 'var(--green)' : 'var(--text-faint)', fontWeight: 700 }}>{clientText}</span>
                      <a href={entry.docsUrl} target="_blank" rel="noreferrer" title={`${entry.name} docs`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 9.5, color: 'var(--text-dim)', textDecoration: 'none', borderBottom: '1px dotted var(--text-faint)' }}>
                        {copy.docs}
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ position: 'sticky', top: 18 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, minHeight: '100%' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>{copy.generator}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginBottom: 14 }}>{copy.generatorHint}</div>

            {result && (
              <div style={{ fontSize: 11, padding: '8px 12px', borderRadius: 5, marginBottom: 10, background: result.ok ? 'var(--green-dim)' : 'var(--red-dim)', color: result.ok ? 'var(--green)' : 'var(--red)' }}>{result.text}</div>
            )}

            <input value={email} onChange={e => setEmail(e.target.value)} placeholder={copy.keyPlaceholder} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 13px', color: 'var(--text-bright)', fontSize: 13, outline: 'none', marginBottom: 10 }} />
            <input value={display} onChange={e => setDisplay(e.target.value)} placeholder={copy.displayPlaceholder} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 13px', color: 'var(--text-bright)', fontSize: 13, outline: 'none', marginBottom: 10 }} />
            <select value={group} onChange={e => setGroup(e.target.value)} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 13px', color: 'var(--text-bright)', fontSize: 13, marginBottom: 10 }}>
              {groups.length === 0 && <option value="">{copy.noGroups}</option>}
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
              <option value="__new__">{copy.newGroup}</option>
            </select>
            {group === '__new__' && (
              <input value={customGroup} onChange={e => setCustomGroup(e.target.value)} placeholder={copy.newGroupPlaceholder} style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '10px 13px', color: 'var(--text-bright)', fontSize: 13, outline: 'none', marginBottom: 10 }} />
            )}

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.8, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>
                {copy.presets}
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--text-dim)', marginBottom: 12 }}>
                {copy.presetsHint}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
              {PRESETS.map((preset) => {
                // A named preset is active only on exact match. Custom is the
                // fallback: highlight when the selection matches no other preset
                // (includes any user-assembled combination and the empty case).
                const namedMatch = PRESETS.some(p => p.id !== 'custom' && arraysEqual(p.protocols, protocols));
                const active = preset.id === 'custom' ? namedMatch === false && protocols.length > 0 : arraysEqual(preset.protocols, protocols);
                return (
                  <button key={preset.id} type="button" onClick={() => setProtocols(preset.id === 'custom' ? [] : [...preset.protocols])} title={preset.desc[lang as 'en'] ?? preset.desc.en}
                    style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 14px', borderRadius: 8, minHeight: 112, background: active ? 'var(--accent-dim)' : 'var(--surface-hover)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`, boxShadow: active ? 'inset 0 0 0 1px rgba(0,212,255,0.16)' : 'none', color: 'inherit', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: active ? 'var(--accent)' : 'var(--text-bright)', lineHeight: 1.1 }}>{preset.label[lang as 'en'] ?? preset.label.en}</span>
                    <span style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-dim)' }}>{preset.desc[lang as 'en'] ?? preset.desc.en}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginBottom: 5 }}>{copy.selected(protocols.length)}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14, minHeight: 24 }}>
              {protocols.length === 0 && <span style={{ fontSize: 10, color: 'var(--red)' }}>{copy.selectAtLeastOne}</span>}
              {protocols.map(k => {
                const e = status.find(s => s.entry.key === k)?.entry;
                if (!e) return null;
                return (
                  <button key={k} onClick={() => toggleProtocol(k)} title={copy.removeFromKey} style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: `${e.color}1a`, color: e.color, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {e.name} ✕
                  </button>
                );
              })}
            </div>

            <button onClick={create} disabled={creating || !email || protocols.length === 0} style={{ width: '100%', background: (creating || !email || protocols.length === 0) ? 'var(--accent-dim)' : 'var(--accent)', color: 'var(--bg)', border: 'none', padding: '11px 12px', borderRadius: 7, fontSize: 13, fontWeight: 800, cursor: (creating || !email || protocols.length === 0) ? 'not-allowed' : 'pointer' }}>
              {creating ? copy.create : copy.generate}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
