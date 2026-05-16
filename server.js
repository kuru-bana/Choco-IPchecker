const express = require('express');
const geoip = require('geoip-country');
const maxmind = require('maxmind');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const GEOLITE2_LICENSE_KEY = process.env.GEOLITE2_LICENSE_KEY || '';
const DATA_DIR = process.env.VERCEL ? '/tmp/choco-ip-data' : path.join(__dirname, 'data');
const CITY_MMDB_PATH = path.join(DATA_DIR, 'GeoLite2-City.mmdb');
const ASN_MMDB_PATH  = path.join(DATA_DIR, 'GeoLite2-ASN.mmdb');

const PING_INTERVAL_MS      = 5 * 60 * 1000;
const DB_UPDATE_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

let cityLookup = null;
let asnLookup  = null;

const serverStatus = {
    startedAt: new Date(),
    pingCount: 0,
    dbLastUpdatedAt: null,
    dbNextUpdateAt: null,
};

async function initMaxmind() {
    try {
        cityLookup = await maxmind.open(CITY_MMDB_PATH);
        console.log('GeoLite2-City データベースを読み込みました');
    } catch (e) {
        console.error('GeoLite2-City の読み込みに失敗しました:', e.message);
    }
    try {
        asnLookup = await maxmind.open(ASN_MMDB_PATH);
        console.log('GeoLite2-ASN データベースを読み込みました');
    } catch (e) {
        console.error('GeoLite2-ASN の読み込みに失敗しました:', e.message);
    }
}

function downloadMmdb(editionId, destPath) {
    const initialUrl = `https://download.maxmind.com/app/geoip_download?edition_id=${editionId}&license_key=${GEOLITE2_LICENSE_KEY}&suffix=tar.gz`;
    const tmpPath = destPath + '.tmp';

    function doGet(url, redirectsLeft) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
                    res.resume();
                    if (redirectsLeft <= 0) return reject(new Error('リダイレクト回数が多すぎます'));
                    return resolve(doGet(res.headers.location, redirectsLeft - 1));
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`ダウンロード失敗: HTTP ${res.statusCode}`));
                }
                const tar = require('child_process').spawn('tar', [
                    '-xzO', '--wildcards', `*/${editionId}.mmdb`
                ]);
                const out = fs.createWriteStream(tmpPath);
                res.pipe(tar.stdin);
                tar.stdout.pipe(out);
                out.on('finish', () => {
                    fs.rename(tmpPath, destPath, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                tar.stderr.on('data', () => {});
                tar.on('error', reject);
                out.on('error', reject);
            }).on('error', reject);
        });
    }

    return doGet(initialUrl, 10);
}

async function refreshDatabases(onProgress) {
    const emit = (msg) => {
        console.log(msg);
        if (onProgress) onProgress(msg);
    };
    emit(`[DB更新] ${new Date().toISOString()} — GeoLite2 データベースの更新を開始します`);
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

        emit('[DB更新] GeoLite2-City ダウンロード中...');
        await downloadMmdb('GeoLite2-City', CITY_MMDB_PATH);
        emit('[DB更新] GeoLite2-City ダウンロード完了');
        cityLookup = await maxmind.open(CITY_MMDB_PATH);
        emit('[DB更新] GeoLite2-City 再読み込み完了');

        emit('[DB更新] GeoLite2-ASN ダウンロード中...');
        await downloadMmdb('GeoLite2-ASN', ASN_MMDB_PATH);
        emit('[DB更新] GeoLite2-ASN ダウンロード完了');
        asnLookup = await maxmind.open(ASN_MMDB_PATH);
        emit('[DB更新] GeoLite2-ASN 再読み込み完了');

        serverStatus.dbLastUpdatedAt = new Date();
        serverStatus.dbNextUpdateAt = new Date(Date.now() + DB_UPDATE_INTERVAL_MS);
        emit('[DB更新] ✅ 完了');
    } catch (e) {
        emit(`[DB更新] ❌ 失敗: ${e.message}`);
    }
}

function startSelfPing() {
    const baseUrl = process.env.RENDER_EXTERNAL_URL
        ? process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')
        : `http://localhost:${PORT}`;
    const pingUrl = `${baseUrl}/api/check/light/me`;
    const client = pingUrl.startsWith('https') ? https : http;

    setInterval(() => {
        client.get(pingUrl, (res) => {
            serverStatus.pingCount++;
            console.log(`[自己ping] ${new Date().toISOString()} — ${res.statusCode} (計${serverStatus.pingCount}回)`);
            res.resume();
        }).on('error', (e) => {
            console.warn('[自己ping] 失敗:', e.message);
        });
    }, PING_INTERVAL_MS);

    console.log(`[自己ping] 開始 — ${PING_INTERVAL_MS / 1000}秒ごとに ${pingUrl} を叩きます`);
}

function startDbAutoUpdate() {
    serverStatus.dbNextUpdateAt = new Date(Date.now() + DB_UPDATE_INTERVAL_MS);
    setInterval(refreshDatabases, DB_UPDATE_INTERVAL_MS);
    console.log(`[DB自動更新] ${DB_UPDATE_INTERVAL_MS / 86400000}日ごとに更新します`);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body || {};
    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'パスワードが正しくありません' });
    }
    res.json({ ok: true });
});

app.post('/api/admin/update-db', async (req, res) => {
    const { password } = req.body || {};
    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'ADMIN_PASSWORD が設定されていません' });
    }
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'パスワードが正しくありません' });
    }
    res.json({ message: 'DB更新を開始しました' });
    refreshDatabases();
});

app.post('/api/admin/update-db-stream', async (req, res) => {
    const { password } = req.body || {};
    if (!ADMIN_PASSWORD) {
        res.status(500).end();
        return;
    }
    if (password !== ADMIN_PASSWORD) {
        res.status(401).end();
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (msg) => {
        res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);
    };

    await refreshDatabases(send);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
});

app.get('/api/db-info', (req, res) => {
    const result = {};

    for (const [key, lookup, filePath] of [
        ['city', cityLookup, CITY_MMDB_PATH],
        ['asn',  asnLookup,  ASN_MMDB_PATH],
    ]) {
        if (!lookup) {
            result[key] = null;
            continue;
        }
        const meta = lookup.metadata;
        let fileSize = null;
        try { fileSize = fs.statSync(filePath).size; } catch {}

        result[key] = {
            databaseType:   meta.databaseType,
            description:    meta.description?.en || null,
            buildEpoch:     meta.buildEpoch,
            ipVersion:      meta.ipVersion,
            languages:      meta.languages || [],
            nodeCount:      meta.nodeCount,
            recordSize:     meta.recordSize,
            treeDepth:      meta.treeDepth,
            fileSizeBytes:  fileSize,
            binaryFormat:   `${meta.binaryFormatMajorVersion}.${meta.binaryFormatMinorVersion}`,
        };
    }

    res.json(result);
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/db-info', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'db-info.html'));
});

app.get('/api/db-info/city-samples', (req, res) => {
    if (!cityLookup) return res.status(503).json({ error: 'DBが読み込まれていません' });

    const samples = [
        { ip: '8.8.8.8',         label: 'Google DNS',         region: '北米' },
        { ip: '1.1.1.1',         label: 'Cloudflare DNS',     region: 'オセアニア' },
        { ip: '185.60.216.35',   label: 'Meta (Facebook)',    region: 'ヨーロッパ' },
        { ip: '202.12.27.33',    label: 'JPNIC',              region: 'アジア' },
        { ip: '103.21.244.0',    label: 'Cloudflare SG',      region: 'アジア' },
        { ip: '41.215.180.1',    label: 'MTN Ghana',          region: 'アフリカ' },
        { ip: '190.220.1.1',     label: 'Telecom Argentina',  region: '南米' },
        { ip: '193.0.6.139',     label: 'RIPE NCC',           region: 'ヨーロッパ' },
        { ip: '149.112.112.112', label: 'Quad9 DNS',          region: '北米' },
        { ip: '156.154.70.1',    label: 'Neustar DNS',        region: '北米' },
        { ip: '45.11.45.11',     label: 'Yandex DNS',         region: 'ヨーロッパ' },
        { ip: '139.130.4.5',     label: 'AARNet',             region: 'オセアニア' },
    ];

    const results = samples.map(({ ip, label, region }) => {
        const d = cityLookup.get(ip);
        const asn = lookupAsn(ip);
        if (!d) return { ip, label, region, found: false };
        const cc = d.country?.iso_code || d.registered_country?.iso_code || null;
        return {
            ip, label, region, found: true,
            country_code: cc,
            country_ja: cc ? getCountryName(cc) : null,
            country_en: d.country?.names?.en || null,
            continent_ja: d.continent?.names?.ja || d.continent?.names?.en || null,
            city_ja: d.city?.names?.ja || d.city?.names?.en || null,
            city_en: d.city?.names?.en || null,
            subdivision_ja: d.subdivisions?.[0]?.names?.ja || d.subdivisions?.[0]?.names?.en || null,
            postal_code: d.postal?.code || null,
            latitude: d.location?.latitude ?? null,
            longitude: d.location?.longitude ?? null,
            accuracy_radius_km: d.location?.accuracy_radius ?? null,
            time_zone: d.location?.time_zone || null,
            is_eu: d.country?.is_in_european_union ?? null,
            asn: asn?.asn || null,
            organization: asn?.organization || null,
        };
    });

    res.json({ samples: results });
});

app.get('/city-info', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'city-info.html'));
});

app.get('/api/db-info/asn-samples', (req, res) => {
    if (!asnLookup) return res.status(503).json({ error: 'ASN DBが読み込まれていません' });

    const samples = [
        { ip: '8.8.8.8',          label: 'Google DNS',          category: '検索・クラウド' },
        { ip: '1.1.1.1',          label: 'Cloudflare DNS',      category: 'CDN・セキュリティ' },
        { ip: '208.67.222.222',   label: 'OpenDNS (Cisco)',      category: 'エンタープライズ' },
        { ip: '149.112.112.112',  label: 'Quad9 DNS',           category: 'セキュリティ' },
        { ip: '17.253.144.10',    label: 'Apple',               category: '大手テック' },
        { ip: '185.60.216.35',    label: 'Meta (Facebook)',      category: 'SNS・大手テック' },
        { ip: '13.107.42.14',     label: 'Microsoft',           category: '大手テック' },
        { ip: '202.12.27.33',     label: 'JPNIC',               category: 'レジストリ' },
        { ip: '193.0.6.139',      label: 'RIPE NCC',            category: 'レジストリ' },
        { ip: '103.21.244.0',     label: 'Cloudflare SG',       category: 'CDN・セキュリティ' },
        { ip: '4.2.2.1',          label: 'Lumen (Level3)',       category: 'バックボーン' },
        { ip: '41.215.180.1',     label: 'MTN Ghana',           category: '通信キャリア' },
        { ip: '190.220.1.1',      label: 'Telecom Argentina',   category: '通信キャリア' },
        { ip: '139.130.4.5',      label: 'AARNet (Australia)',  category: '研究ネットワーク' },
        { ip: '45.11.45.11',      label: 'Yandex DNS',          category: '検索・クラウド' },
        { ip: '208.215.179.1',    label: 'AT&T',                category: '通信キャリア' },
    ];

    const results = samples.map(({ ip, label, category }) => {
        const d = asnLookup.get(ip);
        const city = cityLookup ? cityLookup.get(ip) : null;
        const cc = city?.country?.iso_code || city?.registered_country?.iso_code || null;
        if (!d) return { ip, label, category, found: false };
        return {
            ip, label, category, found: true,
            asn_number: d.autonomous_system_number || null,
            asn: d.autonomous_system_number ? `AS${d.autonomous_system_number}` : null,
            organization: d.autonomous_system_organization || null,
            country_code: cc,
            country_ja: cc ? getCountryName(cc) : null,
        };
    });

    res.json({ samples: results });
});

app.get('/asn-info', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'asn-info.html'));
});

function getCountryName(code) {
    const names = new Intl.DisplayNames(['ja'], { type: 'region' });
    try { return names.of(code) || code; } catch { return code; }
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for']?.split(',')[0].trim();
    const raw = forwarded || req.socket.remoteAddress || '';
    return raw.replace(/^::ffff:/, '');
}

function lookupAsn(ip) {
    if (!asnLookup) return null;
    const data = asnLookup.get(ip);
    if (!data) return null;
    return {
        asn: data.autonomous_system_number ? `AS${data.autonomous_system_number}` : null,
        asn_number: data.autonomous_system_number || null,
        organization: data.autonomous_system_organization || null,
    };
}

app.get('/api/check/light/me', (req, res) => {
    const ip = getClientIp(req);
    const geo = geoip.lookup(ip);
    if (!geo) return res.status(404).json({ ip, error: '位置情報が見つかりませんでした。' });
    return res.json({ ip, country: geo.country, country_name: getCountryName(geo.country) });
});

app.get('/api/check/light/:ip', (req, res) => {
    const ip = req.params.ip;
    if (!ip || ip.trim() === '') return res.status(400).json({ error: 'IPアドレスが指定されていません' });
    const geo = geoip.lookup(ip);
    if (!geo) return res.status(404).json({ ip, error: '位置情報が見つかりませんでした。プライベートIPアドレスまたは無効なIPアドレスの可能性があります。' });
    return res.json({ ip, country: geo.country, country_name: getCountryName(geo.country) });
});

app.get('/api/check/asn/:ip', (req, res) => {
    const ip = req.params.ip;
    if (!ip || ip.trim() === '') return res.status(400).json({ error: 'IPアドレスが指定されていません' });
    if (!asnLookup) return res.status(503).json({ error: 'GeoLite2-ASN データベースが利用できません' });
    const asn = lookupAsn(ip);
    if (!asn) return res.status(404).json({ ip, error: 'ASN情報が見つかりませんでした。' });
    return res.json({ ip, ...asn });
});

app.get('/api/check/detail/:ip', (req, res) => {
    const ip = req.params.ip;
    if (!ip || ip.trim() === '') return res.status(400).json({ error: 'IPアドレスが指定されていません' });
    if (!cityLookup) return res.status(503).json({ error: 'GeoLite2 データベースが利用できません' });

    const data = cityLookup.get(ip);
    if (!data) return res.status(404).json({ ip, error: '詳細な位置情報が見つかりませんでした。' });

    const countryCode = data.country?.iso_code || data.registered_country?.iso_code || null;
    const asn = lookupAsn(ip);

    return res.json({
        ip,
        country_code: countryCode,
        country_name_ja: countryCode ? getCountryName(countryCode) : null,
        country_name_en: data.country?.names?.en || data.registered_country?.names?.en || null,
        continent_code: data.continent?.code || null,
        continent_name_ja: data.continent?.names?.ja || data.continent?.names?.en || null,
        city_name_ja: data.city?.names?.ja || data.city?.names?.en || null,
        city_name_en: data.city?.names?.en || null,
        subdivision_name_ja: data.subdivisions?.[0]?.names?.ja || data.subdivisions?.[0]?.names?.en || null,
        subdivision_name_en: data.subdivisions?.[0]?.names?.en || null,
        postal_code: data.postal?.code || null,
        latitude: data.location?.latitude ?? null,
        longitude: data.location?.longitude ?? null,
        accuracy_radius_km: data.location?.accuracy_radius ?? null,
        time_zone: data.location?.time_zone || null,
        is_in_european_union: data.country?.is_in_european_union ?? null,
        asn: asn?.asn || null,
        asn_number: asn?.asn_number || null,
        organization: asn?.organization || null,
    });
});

app.get('/api/status', (req, res) => {
    const now = Date.now();
    const uptimeMs = now - serverStatus.startedAt.getTime();
    const uptimeDays   = Math.floor(uptimeMs / 86400000);
    const uptimeHours  = Math.floor((uptimeMs % 86400000) / 3600000);
    const uptimeMins   = Math.floor((uptimeMs % 3600000) / 60000);

    res.json({
        started_at: serverStatus.startedAt.toISOString(),
        uptime: `${uptimeDays}日 ${uptimeHours}時間 ${uptimeMins}分`,
        ping_count: serverStatus.pingCount,
        ping_interval_minutes: PING_INTERVAL_MS / 60000,
        db_last_updated_at: serverStatus.dbLastUpdatedAt?.toISOString() || null,
        db_next_update_at: serverStatus.dbNextUpdateAt?.toISOString() || null,
        db_update_interval_days: DB_UPDATE_INTERVAL_MS / 86400000,
        db_city_loaded: cityLookup !== null,
        db_asn_loaded: asnLookup !== null,
    });
});

// ── 包括的IPスキャン（GeoLite2-City 全ネットワーク自動探索） ──
let _compData     = null;
let _compBuilding = false;
let _compReady    = false;
let _compStats    = { countries: 0, regions: 0, ips: 0, probes: 0 };
let _compProgress = 0; // 0–100

function _makeEntry(ip, data, cc) {
    const asn = lookupAsn(ip);
    return {
        ip,
        country_code:       cc,
        country_name_ja:    getCountryName(cc),
        country_name_en:    data.country?.names?.en || data.registered_country?.names?.en || cc,
        continent_code:     data.continent?.code || null,
        subdivision_en:     data.subdivisions?.[0]?.names?.en || null,
        subdivision_ja:     data.subdivisions?.[0]?.names?.ja || data.subdivisions?.[0]?.names?.en || null,
        city_en:            data.city?.names?.en || null,
        city_ja:            data.city?.names?.ja || data.city?.names?.en || null,
        postal_code:        data.postal?.code || null,
        latitude:           data.location?.latitude  ?? null,
        longitude:          data.location?.longitude ?? null,
        accuracy_radius_km: data.location?.accuracy_radius ?? null,
        time_zone:          data.location?.time_zone || null,
        is_eu:              data.country?.is_in_european_union ?? null,
        asn:                asn?.asn || null,
        asn_number:         asn?.asn_number || null,
        organization:       asn?.organization || null,
    };
}

async function buildComprehensiveData() {
    if (!cityLookup || _compBuilding || _compReady) return;
    _compBuilding = true;
    _compProgress = 0;
    const t0 = Date.now();
    console.log('[探索] GeoLite2-City 全IPv4空間スキャン開始...');

    const seen       = new Set();
    const countryMap = {};
    let probes = 0;

    // Sample 4 points per /16 block (254×256 blocks × 4 = ~260k probes)
    const C_OFFSETS = [1, 64, 129, 193];

    for (let a = 1; a <= 254; a++) {
        for (let b = 0; b <= 255; b++) {
            for (const c of C_OFFSETS) {
                const ip = `${a}.${b}.${c}.1`;
                probes++;
                try {
                    const data = cityLookup.get(ip);
                    if (!data) continue;
                    const cc = data.country?.iso_code || data.registered_country?.iso_code;
                    if (!cc) continue;

                    const subEn  = data.subdivisions?.[0]?.names?.en || '';
                    const cityEn = data.city?.names?.en              || '';
                    const key    = `${cc}|${subEn}|${cityEn}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const entry  = _makeEntry(ip, data, cc);
                    const subKey = subEn || '(その他)';

                    if (!countryMap[cc]) {
                        countryMap[cc] = {
                            code: cc, name_ja: entry.country_name_ja,
                            name_en: entry.country_name_en,
                            continent: entry.continent_code,
                            subdivisions: {},
                        };
                    }
                    if (!countryMap[cc].subdivisions[subKey]) {
                        countryMap[cc].subdivisions[subKey] = {
                            name_en: subEn || '(その他)',
                            name_ja: entry.subdivision_ja || '(その他)',
                            ips: [],
                        };
                    }
                    countryMap[cc].subdivisions[subKey].ips.push(entry);
                } catch (_) {}
            }
        }
        // yield to event loop every 10 /8 slices
        if (a % 10 === 0) {
            _compProgress = Math.round((a / 254) * 84);
            await new Promise(r => setImmediate(r));
        }
    }

    // ── Phase 2: IPv6 主要アドレス帯サンプリング ──
    // RIR ブロック: 2001 (IANA), 2002 (6to4), 2400-240f (APNIC),
    //               2600-260f (ARIN), 2800-280f (LACNIC),
    //               2a00-2a0f (RIPE NCC), 2c00-2c0f (AFRINIC), 240e (China Telecom)
    console.log('[探索] GeoLite2-City IPv6帯サンプリング開始...');
    const ipv6FirstGroups = [
        0x2001, 0x2002, 0x240e,
        ...Array.from({ length: 16 }, (_, i) => 0x2400 + i),
        ...Array.from({ length: 16 }, (_, i) => 0x2600 + i),
        ...Array.from({ length: 16 }, (_, i) => 0x2800 + i),
        ...Array.from({ length: 16 }, (_, i) => 0x2a00 + i),
        ...Array.from({ length: 16 }, (_, i) => 0x2c00 + i),
    ];
    const SECOND_STEP = 0x1000; // 16 probes per /16 → 16×83 ≈ 1300 IPv6 probes total

    for (let fi = 0; fi < ipv6FirstGroups.length; fi++) {
        const fg = ipv6FirstGroups[fi];
        for (let sg = 0; sg < 0x10000; sg += SECOND_STEP) {
            const ip6 = `${fg.toString(16)}:${sg.toString(16).padStart(4, '0')}::1`;
            probes++;
            try {
                const data = cityLookup.get(ip6);
                if (!data) continue;
                const cc = data.country?.iso_code || data.registered_country?.iso_code;
                if (!cc) continue;

                const subEn  = data.subdivisions?.[0]?.names?.en || '';
                const cityEn = data.city?.names?.en              || '';
                const key    = `v6|${cc}|${subEn}|${cityEn}`;
                if (seen.has(key)) continue;
                seen.add(key);

                const entry  = _makeEntry(ip6, data, cc);
                const subKey = subEn || '(その他)';

                if (!countryMap[cc]) {
                    countryMap[cc] = {
                        code: cc, name_ja: entry.country_name_ja,
                        name_en: entry.country_name_en,
                        continent: entry.continent_code,
                        subdivisions: {},
                    };
                }
                if (!countryMap[cc].subdivisions[subKey]) {
                    countryMap[cc].subdivisions[subKey] = {
                        name_en: subEn || '(その他)',
                        name_ja: entry.subdivision_ja || '(その他)',
                        ips: [],
                    };
                }
                countryMap[cc].subdivisions[subKey].ips.push(entry);
            } catch (_) {}
        }
        _compProgress = 85 + Math.round(((fi + 1) / ipv6FirstGroups.length) * 14);
        await new Promise(r => setImmediate(r));
    }

    _compData  = countryMap;
    _compReady = true;
    _compBuilding = false;
    _compProgress = 100;

    const totalRegions = Object.values(countryMap)
        .reduce((s, c) => s + Object.keys(c.subdivisions).length, 0);
    const totalIPs = Object.values(countryMap)
        .reduce((s, c) => s + Object.values(c.subdivisions)
            .reduce((ss, r) => ss + r.ips.length, 0), 0);

    _compStats = { countries: Object.keys(countryMap).length, regions: totalRegions, ips: totalIPs, probes };
    console.log(`[探索] 完了 (${Date.now() - t0}ms): ${_compStats.countries} 国 / ${_compStats.regions} 地域 / ${_compStats.ips} レコード`);
}

function _buildAllResponse() {
    const CONT_ORDER = ['AS','EU','NA','SA','OC','AF','AN'];
    return Object.values(_compData)
        .sort((a, b) => {
            const ci = CONT_ORDER.indexOf(a.continent) - CONT_ORDER.indexOf(b.continent);
            return ci !== 0 ? ci : (a.name_en || '').localeCompare(b.name_en || '');
        })
        .map(c => ({
            code:         c.code,
            name_ja:      c.name_ja,
            name_en:      c.name_en,
            continent:    c.continent,
            region_count: Object.keys(c.subdivisions).length,
            ip_count:     Object.values(c.subdivisions).reduce((s, r) => s + r.ips.length, 0),
            regions:      Object.values(c.subdivisions)
                .sort((a, b) => (a.name_en || '').localeCompare(b.name_en || ''))
                .map(r => ({ name_en: r.name_en, name_ja: r.name_ja, ips: r.ips })),
        }));
}

app.get('/api/city-explore/status', (req, res) => {
    res.json({ ready: _compReady, building: _compBuilding, progress: _compProgress, stats: _compStats });
});

app.get('/api/city-explore/countries', (req, res) => {
    if (!cityLookup)  return res.status(503).json({ error: 'DB未ロード' });
    if (!_compReady)  return res.status(202).json({ building: true, progress: _compProgress });
    res.json({ countries: _buildAllResponse().map(({ regions, ...c }) => c) });
});

app.get('/api/city-explore/country/:code', (req, res) => {
    if (!cityLookup)  return res.status(503).json({ error: 'DB未ロード' });
    if (!_compReady)  return res.status(202).json({ building: true, progress: _compProgress });
    const cc = req.params.code.toUpperCase();
    const c  = _compData[cc];
    if (!c) return res.status(404).json({ error: '該当する国のデータがありません' });
    const regions = Object.values(c.subdivisions)
        .sort((a, b) => (a.name_en || '').localeCompare(b.name_en || ''));
    res.json({ code: c.code, name_ja: c.name_ja, name_en: c.name_en, regions });
});

app.get('/api/city-explore/all', (req, res) => {
    if (!cityLookup)  return res.status(503).json({ error: 'DB未ロード' });
    if (!_compReady)  return res.status(202).json({ building: true, progress: _compProgress });
    res.json({ countries: _buildAllResponse(), stats: _compStats });
});

app.get('/city-explore/:code', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'city-explore-country.html'));
});

app.get('/city-explore', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'city-explore.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    initMaxmind().then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`サーバーが起動しました: http://0.0.0.0:${PORT}`);
            startSelfPing();
            startDbAutoUpdate();
            setTimeout(() => buildComprehensiveData(), 200);
        });
    });
} else {
    initMaxmind();
    module.exports = app;
}
