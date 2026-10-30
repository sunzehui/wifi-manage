<?php

declare(strict_types=1);

date_default_timezone_set('Asia/Shanghai');

if (PHP_VERSION_ID < 80400) {
    http_response_code(500);
    exit('需要 PHP >= 8.4，当前为 ' . PHP_VERSION);
}

/**
 * 随身 WiFi 后台仪表盘 — 本地网关服务 (PHP 8.4)
 *
 * 职责:
 *   1. 与设备 (默认 http://192.168.1.1) 完成 Digest 一键登录(内置默认账号)
 *   2. 按页面需要提供数据接口:
 *        /api/status   首页主数据 (status1, 热数据, 缓存 ~4s)
 *        /api/traffic  流量页     (statistics, 冷数据, 缓存 ~20s)
 *        /api/devices  设备页     (device_management, 冷数据, 缓存 ~20s)
 *        /api/summary  全量数据   (兼容保留, 并行拉取)
 *        /api/wifi     WiFi 设置  (改名/改密码/开关, 复用设备原厂 set 接口)
 *   3. 页面路由: 命中缓存时向 HTML 注入首屏数据(window.__BOOT__), 实现 0ms 首屏
 *   4. 启动建议开启多 worker, 静态页面不会被数据请求阻塞:
 *        PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8765 -t public server.php
 *
 * 性能设计:
 *   - 设备 Digest 会话落在 .mifi_session.json (flock 互斥), 多 worker 共享、跨重启复用
 *   - 三个数据接口用 curl_multi 并行拉取 (实测 ~1.2s vs 串行 ~5.7s)
 *   - 原始 XML 按不同 TTL 缓存在 .data_cache.json, 首页只依赖 status1
 *
 * 无第三方依赖, 仅用 curl / SimpleXML / JSON 扩展。
 */

/**
 * 设备连接配置（避免把密码提交进仓库）:
 *   优先级: 环境变量 WIFI_HOST / WIFI_USER / WIFI_PASS > config.local.php > 默认值
 *   config.local.php 内容: <?php return ['user' => 'admin', 'pass' => '你的设备密码'];
 */
function deviceConfig(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $local = is_file(__DIR__ . '/config.local.php') ? (require __DIR__ . '/config.local.php') : [];
        $cfg = [
            'host' => getenv('WIFI_HOST') ?: 'http://192.168.1.1',
            'user' => getenv('WIFI_USER') ?: ($local['user'] ?? 'admin'),
            'pass' => getenv('WIFI_PASS') ?: ($local['pass'] ?? ''),
            // 发卡平台的设备号(总流量查询), 见 README
            'mgx_card' => getenv('WIFI_MGX_CARD') ?: ($local['mgx_card'] ?? ''),
        ];
    }
    return $cfg;
}

/**
 * 登录请求的 Digest 计算（纯函数，登录与测试共用；JS 侧对应 core.js 的 loginRequest）。
 * 与原厂前端一致：查询串的 HA2 针对 /cgi/protected.cgi；同时还必须带 HA2 为
 * /cgi/xml_action.cgi 的 Authorization 头，设备靠这个头才真正登记管理会话——
 * 只发查询串会一直返回 UNAUTHORIZED。
 *
 * @return array{0:string,1:string} [login 路径(含查询串), Authorization 头]
 */
function digestLoginRequest(array $cfg, array $challenge, ?string $cnonce = null): array
{
    $nc       = '00000001';
    $cnonce   = $cnonce ?? substr(md5(uniqid('', true)), 0, 16);
    $ha1      = md5($cfg['user'] . ':' . $challenge['realm'] . ':' . $cfg['pass']);
    $resp     = md5("{$ha1}:{$challenge['nonce']}:{$nc}:{$cnonce}:{$challenge['qop']}:" . md5('GET:/cgi/protected.cgi'));
    $authResp = md5("{$ha1}:{$challenge['nonce']}:{$nc}:{$cnonce}:{$challenge['qop']}:" . md5('GET:/cgi/xml_action.cgi'));
    $path = '/login.cgi?Action=Digest&username=' . urlencode($cfg['user'])
        . '&realm=' . urlencode($challenge['realm'])
        . '&nonce=' . urlencode($challenge['nonce'])
        . "&response={$resp}&qop={$challenge['qop']}&cnonce={$cnonce}&temp=asr";
    $auth = 'Digest username="' . $cfg['user'] . '", realm="' . $challenge['realm'] . '"'
        . ', nonce="' . $challenge['nonce'] . '", uri="/cgi/xml_action.cgi"'
        . ', response="' . $authResp . '", qop=' . $challenge['qop']
        . ", nc={$nc}, cnonce=\"{$cnonce}\"";
    return [$path, $auth];
}

/* ===================== 设备 Digest 会话 (多 worker 共享) ===================== */

final class MifiSession
{
    private const SESSION_FILE = __DIR__ . '/.mifi_session.json';
    private const SESSION_MAX_AGE = 480;   // 设备会话空闲约 10 分钟超时, 8 分钟后弃用

    private static ?self $instance = null;

    private ?string $realm = null;
    private ?string $nonce = null;
    private ?string $qop   = null;

    public static function i(): self
    {
        return self::$instance ??= new self();
    }

    private function __construct()
    {
        $raw = @file_get_contents(self::SESSION_FILE);
        $s   = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($s) && ($s['ts'] ?? 0) >= time() - self::SESSION_MAX_AGE) {
            $this->realm = $s['realm'] ?? null;
            $this->nonce = $s['nonce'] ?? null;
            $this->qop   = $s['qop'] ?? 'auth';
        }
    }

    public function hasSession(): bool
    {
        return $this->nonce !== null;
    }

    private function saveSession(int $nc = 1): void
    {
        @file_put_contents(self::SESSION_FILE, json_encode([
            'realm' => $this->realm,
            'nonce' => $this->nonce,
            'qop'   => $this->qop,
            'nc'    => $nc,
            'ts'    => time(),
        ]));
    }

    /** 发送 GET, 返回 [响应体, 响应头数组] */
    private function httpGet(string $path, ?string $authHeader = null, int $timeout = 8): array
    {
        return $this->httpRequest('GET', $path, null, $authHeader, $timeout);
    }

    /** 发送 POST, 返回 [响应体, 响应头数组] */
    private function httpPost(string $path, string $body, ?string $authHeader = null, int $timeout = 10): array
    {
        return $this->httpRequest('POST', $path, $body, $authHeader, $timeout);
    }

    private function httpRequest(string $method, string $path, ?string $body, ?string $authHeader, int $timeout): array
    {
        $ch = curl_init(deviceConfig()['host'] . $path);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER         => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER     => $authHeader ? ['Authorization: ' . $authHeader] : [],
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST]       = true;
            $opts[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('无法连接设备(' . deviceConfig()['host'] . '): ' . $err);
        }
        $hSize   = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        $headers = [];
        foreach (preg_split('/\r?\n/', substr((string) $raw, 0, $hSize)) ?: [] as $line) {
            $idx = strpos($line, ':');
            if ($idx !== false) {
                $headers[trim(substr($line, 0, $idx))] = trim(substr($line, $idx + 1));
            }
        }
        return [substr((string) $raw, $hSize), $headers];
    }

    /** 解析质询头: Digest realm="..", nonce="..", qop="auth" */
    private function parseChallenge(string $header): ?array
    {
        if (!preg_match('/^Digest/i', $header)) {
            return null;
        }
        preg_match('/realm="([^"]+)"/i', $header, $realm);
        preg_match('/nonce="([^"]+)"/i', $header, $nonce);
        preg_match('/qop="([^"]+)"/i', $header, $qop);
        if (!$realm || !$nonce) {
            return null;
        }
        return ['realm' => $realm[1], 'nonce' => $nonce[1], 'qop' => $qop[1] ?? 'auth'];
    }

    /** @var int 登录失败退避截止时间戳 (防止高频登录触发设备保护锁定) */
    private static int $loginBlockedUntil = 0;

    /** 登录握手: 取质询 -> 计算 response -> login.cgi 校验; nonce 留作后续数据请求 */
    public function login(): void
    {
        if (deviceConfig()['pass'] === '') {
            throw new RuntimeException('未配置设备密码: 请设置环境变量 WIFI_PASS, 或创建 config.local.php (内容见 README「配置」一节)');
        }
        if (time() < self::$loginBlockedUntil) {
            throw new RuntimeException('设备暂时拒绝登录(疑似触发登录保护), ' . (self::$loginBlockedUntil - time()) . ' 秒后自动恢复');
        }
        [, $headers] = $this->httpGet('/login.cgi');
        $challenge = $this->parseChallenge($headers['WWW-Authenticate'] ?? '');
        if ($challenge === null) {
            throw new RuntimeException('设备未返回 Digest 质询, 请确认已连接到随身 WiFi');
        }
        $this->realm = $challenge['realm'];
        $this->nonce = $challenge['nonce'];
        $this->qop   = $challenge['qop'];

        [$loginPath, $loginAuth] = digestLoginRequest(
            ['user' => deviceConfig()['user'], 'pass' => deviceConfig()['pass']],
            $challenge
        );
        $this->httpGet($loginPath, $loginAuth);
        $this->saveSession(nc: 1);
    }

    /**
     * 为一次数据请求生成 Authorization 头 (uri 固定 /cgi/xml_action.cgi)。
     * realm/nonce/nc 全部以会话文件为准并在文件锁内分配, 保证多 worker 并发时 nc 不重号。
     */
    private function authHeader(string $method = 'GET'): string
    {
        $fp = fopen(self::SESSION_FILE, 'c+');
        if ($fp === false) {
            throw new RuntimeException('无法打开会话文件');
        }
        flock($fp, LOCK_EX);
        $s     = json_decode((string) stream_get_contents($fp), true) ?: [];
        $realm = $s['realm'] ?? $this->realm;
        $nonce = $s['nonce'] ?? $this->nonce;
        $qop   = $s['qop']   ?? $this->qop ?? 'auth';
        $nc    = max(1, (int) ($s['nc'] ?? 1));
        $ncStr = str_pad((string) $nc, 8, '0', STR_PAD_LEFT);
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode(['realm' => $realm, 'nonce' => $nonce, 'qop' => $qop, 'nc' => $nc + 1, 'ts' => time()]));
        flock($fp, LOCK_UN);
        fclose($fp);

        $ha1    = md5(implode(':', [deviceConfig()['user'], $realm, deviceConfig()['pass']]));
        $ha2    = md5($method . ':/cgi/xml_action.cgi');
        $cnonce = substr(md5(uniqid('', true)), 0, 16);
        $resp   = md5("{$ha1}:{$nonce}:{$ncStr}:{$cnonce}:{$qop}:{$ha2}");
        return 'Digest username="' . deviceConfig()['user'] . '", realm="' . $realm . '"'
            . ', nonce="' . $nonce . '", uri="/cgi/xml_action.cgi"'
            . ', response="' . $resp . '", qop=' . $qop
            . ', nc=' . $ncStr . ', cnonce="' . $cnonce . '"';
    }

    /** 拉取一个数据文件; 会话失效时自动重新握手并重试一次 */
    public function fetchXml(string $file): string
    {
        return $this->fetchXmlParallel([$file])[$file];
    }

    /**
     * 并行拉取多个数据文件 (curl_multi), 返回 [file => xml]。
     * 任一失败 (nonce 过期等) 会重新登录并把失败的文件重试一次。
     */
    public function fetchXmlParallel(array $files): array
    {
        if (!$this->hasSession()) {
            $this->login();
        }
        $ok      = [];
        $pending = array_values($files);
        foreach ([0, 1] as $attempt) {
            foreach ($this->multiGet($pending) as $file => [$body, $headers]) {
                if (str_contains($body, '<RGW') && !str_contains($body, 'UNAUTHORIZED')) {
                    $ok[$file] = $body;
                }
            }
            $pending = array_values(array_diff($pending, array_keys($ok)));
            if ($pending === []) {
                self::$loginBlockedUntil = 0;
                return $ok;
            }
            if ($attempt === 1) {
                self::$loginBlockedUntil = time() + 30;
                throw new RuntimeException('获取设备数据失败: ' . implode(',', $pending));
            }
            $this->login();   // nonce 过期 -> 重新握手
        }
        throw new LogicException('unreachable');
    }

    /** curl_multi 并行 GET; 每个请求预先分配好各自的 Authorization (nc 不重号) */
    private function multiGet(array $files): array
    {
        if ($files === []) {
            return [];
        }
        $mh      = curl_multi_init();
        $handles = [];
        foreach ($files as $file) {
            $ch = curl_init(deviceConfig()['host'] . "/xml_action.cgi?method=get&module=duster&file={$file}&_=" . (int) (microtime(true) * 1000));
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER         => true,
                CURLOPT_TIMEOUT        => 12,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_HTTPHEADER     => ['Authorization: ' . $this->authHeader('GET')],
            ]);
            curl_multi_add_handle($mh, $ch);
            $handles[$file] = $ch;
        }
        do {
            $status = curl_multi_exec($mh, $active);
            if ($active) {
                curl_multi_select($mh, 0.05);
            }
        } while ($active && $status === CURLM_OK);

        $res = [];
        foreach ($handles as $file => $ch) {
            $raw   = (string) curl_multi_getcontent($ch);
            $hSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
            $headers = [];
            foreach (preg_split('/\r?\n/', substr($raw, 0, $hSize)) ?: [] as $line) {
                $idx = strpos($line, ':');
                if ($idx !== false) {
                    $headers[trim(substr($line, 0, $idx))] = trim(substr($line, $idx + 1));
                }
            }
            $res[$file] = [substr($raw, $hSize), $headers];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        return $res;
    }

    /** 向设备下发设置: POST xml_action.cgi?method=set (与原厂前端 postXML 相同通道) */
    public function postXml(string $file, string $xml): string
    {
        if (!$this->hasSession()) {
            $this->login();
        }
        // 原厂 getXMLDocToString 会在序列化结果前加 XML 声明, 设备 CGI 缺它解析会报 500
        $xml = '<?xml version="1.0" encoding="US-ASCII"?> ' . $xml;
        foreach ([0, 1] as $attempt) {
            [$body, $headers] = $this->httpPost(
                "/xml_action.cgi?method=set&module=duster&file={$file}",
                $xml,
                $this->authHeader('POST')
            );
            $failed = str_contains($body, 'UNAUTHORIZED')
                || str_contains($body, 'Error')
                || isset($headers['WWW-Authenticate']);
            if (!$failed) {
                return $body;
            }
            if ($attempt === 1) {
                throw new RuntimeException("设备拒绝了设置请求 ({$file}): " . trim(explode("\n", $body)[0] ?? ''));
            }
            $this->login();
        }
        throw new LogicException('unreachable');
    }
    /**
     * 整机动作 (重启 / 关机): 原厂靠 GET 一个 action 文件触发 (file=reset / power_off),
     * 响应里不一定有 <RGW> 骨架, 所以不能走 fetchXml。
     * 只把「认证被拒」当失败 —— 设备执行动作时常常先把连接断掉, 那属于预期现象。
     */
    public function triggerAction(string $file): void
    {
        if (!$this->hasSession()) {
            $this->login();
        }
        $path = "/xml_action.cgi?method=get&module=duster&file={$file}"
            . '&_=' . (int) (microtime(true) * 1000);
        try {
            [$body, $headers] = $this->httpGet($path, $this->authHeader('GET'), 15);
        } catch (Throwable $e) {
            return;   // 请求已发出, 设备先行断开
        }
        if (!str_contains($body, 'UNAUTHORIZED') && !isset($headers['WWW-Authenticate'])) {
            return;
        }
        $this->login();   // 会话过期: 重登一次再发, 这是唯一"没发出去"的情况
        try {
            [$body, $headers] = $this->httpGet($path, $this->authHeader('GET'), 15);
        } catch (Throwable $e) {
            return;
        }
        if (str_contains($body, 'UNAUTHORIZED') || isset($headers['WWW-Authenticate'])) {
            throw new RuntimeException('设备拒绝了请求，请稍后重试');
        }
    }
}

/* ===================== 数据缓存 (原始 XML, 多 worker 共享) ===================== */

final class DataCache
{
    private const CACHE_FILE = __DIR__ . '/.data_cache.json';

    /** 读取; $staleOk=true 时不检查 TTL, 仅要求存在 */
    public static function get(string $key, float $ttl, bool $staleOk = false): ?string
    {
        $e = self::readAll()[$key] ?? null;
        if (!is_array($e) || !isset($e['xml'])) {
            return null;
        }
        $age = microtime(true) - (float) ($e['ts'] ?? 0);
        return ($staleOk || $age <= $ttl) ? (string) $e['xml'] : null;
    }

    public static function age(string $key): ?float
    {
        $e = self::readAll()[$key] ?? null;
        return is_array($e) ? microtime(true) - (float) ($e['ts'] ?? 0) : null;
    }

    public static function put(string $key, string $xml): void
    {
        $fp = fopen(self::CACHE_FILE, 'c+');
        if ($fp === false) {
            return;
        }
        flock($fp, LOCK_EX);
        $all = json_decode((string) stream_get_contents($fp), true) ?: [];
        $all[$key] = ['xml' => $xml, 'ts' => microtime(true)];
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($all));
        flock($fp, LOCK_UN);
        fclose($fp);
    }

    /** WiFi 设置变更后让对应缓存立即过期 */
    public static function clear(array $keys): void
    {
        $fp = fopen(self::CACHE_FILE, 'c+');
        if ($fp === false) {
            return;
        }
        flock($fp, LOCK_EX);
        $all = json_decode((string) stream_get_contents($fp), true) ?: [];
        foreach ($keys as $k) {
            unset($all[$k]);
        }
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($all));
        flock($fp, LOCK_UN);
        fclose($fp);
    }

    private static function readAll(): array
    {
        $raw = @file_get_contents(self::CACHE_FILE);
        $all = is_string($raw) ? json_decode($raw, true) : null;
        return is_array($all) ? $all : [];
    }
}

/* ===================== XML 解析与字段整理 ===================== */

function sxe(string $xml): SimpleXMLElement
{
    $sxe = simplexml_load_string($xml);
    if ($sxe === false) {
        throw new RuntimeException('设备返回的 XML 无法解析');
    }
    return $sxe;
}

function txt(SimpleXMLElement $node, string $path, string $default = ''): string
{
    $cur = $node;
    foreach (explode('/', $path) as $seg) {
        if (!isset($cur->$seg)) {
            return $default;
        }
        $cur = $cur->$seg;
    }
    return trim((string) $cur);
}

/** SSID 十六进制 UTF-16 解码 (原厂 UniDecode) */
function uniDecode(string $hex): string
{
    if (!preg_match('/^(?:[0-9a-fA-F]{4})+$/', $hex)) {
        return $hex;
    }
    $out = '';
    foreach (str_split($hex, 4) as $chunk) {
        $out .= mb_chr((int) hexdec($chunk), 'UTF-8');
    }
    return $out;
}

function sec2hms(?string $sec): string
{
    $s = max(0, (int) ($sec ?? 0));
    $h = intdiv($s, 3600);
    $m = intdiv($s % 3600, 60);
    return $h > 0 ? "{$h}时{$m}分" . ($s % 60) . '秒'
        : ($m > 0 ? "{$m}分" . ($s % 60) . '秒' : ($s % 60) . '秒');
}

/** 信号格数: 沿用原厂前端阈值 (LTE 按 rsrp, WCDMA 按 rscp) */
function signalBars(int $sysMode, string $rsrpRaw, string $rscpRaw): int
{
    if ($sysMode === 5) {
        $c = (int) $rscpRaw;
        return match (true) {
            $c > 30 && $c <= 96 => 4,
            $c > 26 && $c <= 30 => 3,
            $c > 21 && $c <= 26 => 2,
            $c > 0 && $c <= 21  => 1,
            default             => 0,
        };
    }
    if ($sysMode === 17) {
        $r = (int) $rsrpRaw;
        return match (true) {
            $r > 54 && $r <= 97 => 4,
            $r > 42 && $r <= 54 => 3,
            $r > 33 && $r <= 42 => 2,
            $r > 0  && $r <= 33 => 1,
            default             => 0,
        };
    }
    return 0;
}

const NET_MODES = [
    '2' => 'GPRS', '3' => 'EDGE', '5' => 'HSDPA', '6' => 'HSUPA', '7' => 'HSPA',
    '15' => 'TD-SCDMA', '17' => 'LTE',
];

/** 首页主数据 (status1): 状态/信号/电池/速率/WiFi/运行信息 */
function buildStatus(string $statusXml): array
{
    $status = sxe($statusXml);
    $wan  = $status->wan ?? null;
    $cell = $wan->cellular ?? null;
    $apnItem = $cell->pdp_auto_list->Item ?? null;

    $sysMode = (int) txt($wan, 'sys_mode');
    $rsrpRaw = (int) txt($wan, 'rsrp');
    $rsrqRaw = (int) txt($wan, 'rsrq');
    $rssiRaw = (int) txt($wan, 'rssi');

    $charging = txt($wan, 'Battery_charging') === '1';
    $batteryState = match (true) {
        txt($wan, 'Battery_connect') !== '1' => '无电池',
        !$charging                           => '未充电',
        txt($wan, 'Battery_charge') === '2'  => '已充满',
        txt($wan, 'Battery_charge') === '1'  => '充电中',
        default                              => '已插电',
    };

    return [
        'time' => date('c'),
        'device' => [
            'model'        => txt($status->sysinfo, 'model_name', 'MiFi'),
            'firmware'     => txt($status->sysinfo, 'version_num'),
            'sn'           => txt($wan, 'SN'),
            'imei'         => txt($wan, 'IMEI'),
            'iccid'        => txt($wan, 'ICCID'),
        ],
        'network' => [
            'status'      => txt($wan, 'wan_conn_status', '--'),
            'operator'    => txt($wan, 'network_name', txt($wan, 'ISP_name', '--')),
            'roaming'     => txt($cell, 'roaming') === '1',
            'mode'        => NET_MODES[txt($wan, 'sys_submode')] ?? NET_MODES[$sysMode] ?? '--',
            'signalBars'  => signalBars($sysMode, (string) $rsrpRaw, txt($wan, 'rscp')),
            'rsrpDbm'     => $rsrpRaw >= 0 && $rsrpRaw <= 97 ? -140 + $rsrpRaw : null,
            'rsrqDb'      => $rsrqRaw >= 0 && $rsrqRaw <= 34 ? round(-19.5 + $rsrqRaw / 2, 1) : null,
            'rssiDbm'     => $rssiRaw >= 0 && $rssiRaw <= 63 ? -110 + $rssiRaw : null,
            'sinr'        => txt($wan, 'sinr') !== '' ? (int) txt($wan, 'sinr') : null,
            'pci'         => txt($wan, 'pci') !== '' ? (int) txt($wan, 'pci') : null,
            'cellId'      => txt($wan, 'cellid'),
            'ipv4'        => txt($cell, 'pdp_context_list/Item/ipv4'),
            'gateway'     => txt($cell, 'pdp_context_list/Item/v4gateway'),
            'dns'         => array_values(array_filter([
                txt($cell, 'pdp_context_list/Item/v4dns1'),
                txt($cell, 'pdp_context_list/Item/v4dns2'),
            ])),
            'apn'         => $apnItem ? (string) $apnItem->apn : '',
            'curConnTime' => sec2hms(txt($cell, 'pdp_context_list/Item/curconntime')),
            'totalConnTime' => sec2hms(txt($cell, 'pdp_context_list/Item/totalconntime')),
        ],
        'battery' => [
            'present' => txt($wan, 'Battery_connect') === '1',
            'percent' => txt($wan, 'Battery_connect') === '1' ? (int) txt($wan, 'Battery_voltage') : null,
            'charging'  => $charging,
            'state'     => $batteryState,
        ],
        'rate' => [
            'txRate' => (int) txt($wan, 'tx_rate'),   // B/s
            'rxRate' => (int) txt($wan, 'rx_rate'),   // B/s
        ],
        'wifi' => [
            'enabled'  => txt($status->wlan_settings, 'wlan_enable') === '1',
            'ssid'     => uniDecode(txt($status->wlan_security, 'ssid')),
            'security' => txt($status->wlan_security, 'mode'),
            'channel'  => txt($status->wlan_settings, 'channel') === '0' ? '自动' : txt($status->wlan_settings, 'channel'),
        ],
        'lan' => [
            'ip'             => txt($status->lan, 'ip'),
            'mac'            => txt($status->lan, 'mac'),
            'uptime'         => trim(sprintf('%s%02d时%02d分%02d秒',
                txt($status->lan, 'run_days') !== '' ? txt($status->lan, 'run_days') . '天 ' : '',
                (int) txt($status->lan, 'run_hours'),
                (int) txt($status->lan, 'run_minutes'),
                (int) txt($status->lan, 'run_seconds'))),
            'connectedCount' => (int) txt($status->device_management, 'nr_connected_dev'),
        ],
    ];
}

/** 无线基础配置 (uapxb_wlan_basic_settings): 目前只取「无客户端自动关闭」
 *  字段 wifi_sleep_time: '0' = 关闭该功能, 10~60 = 空闲多少分钟后自动关闭无线
 *  status1 里没有这个字段, 必须单独读这个文件 (与原厂无线设置页同源) */
function buildWlanBasic(string $xml): array
{
    $ws = sxe($xml)->wlan_settings ?? null;
    $raw = $ws !== null ? txt($ws, 'wifi_sleep_time') : '';
    $known = $raw !== '' && preg_match('/^\d+$/', $raw) === 1;
    $n = $known ? (int) $raw : 0;
    return [
        'autoOff' => ['minutes' => $known ? $n : null, 'enabled' => $known ? $n > 0 : null],
    ];
}

/** 流量页数据 (statistics); 时长字段优先复用较新的 status1 缓存 */
function buildTraffic(string $statsXml, ?string $freshStatusXml = null): array
{
    $stats = sxe($statsXml);
    $ws = $stats->statistics->WanStatistics ?? null;
    $cur = $freshStatusXml !== null ? sxe($freshStatusXml) : null;
    return [
        'time' => date('c'),
        'monthUsedBytes' => (int) txt($ws, 'total_used_month'),
        'totalUsedBytes' => (int) txt($ws, 'total_used_unlimit'),
        'quotaBytes'     => (int) txt($ws, 'total_available_month', '0'),   // 用户设置的套餐总量, 0=未设置
        'wanRxPackets'   => txt($ws, 'rx'),
        'wanTxPackets'   => txt($ws, 'tx'),
        'curConnTime'    => $cur ? sec2hms(txt($cur->wan->cellular, 'pdp_context_list/Item/curconntime')) : null,
        'totalConnTime'  => $cur ? sec2hms(txt($cur->wan->cellular, 'pdp_context_list/Item/totalconntime')) : null,
    ];
}

/** 设备页数据 (device_management) */
function buildDevices(string $devicesXml): array
{
    $dm = sxe($devicesXml)->device_management ?? null;
    $clients = [];
    if (isset($dm->client_list->Item)) {
        foreach ($dm->client_list->Item as $c) {
            $clients[] = [
                'name'       => (string) $c->name,
                'mac'        => (string) $c->mac,
                'ip'         => (string) $c->ip_address === 'NA' ? '--' : (string) $c->ip_address,
                'connected'  => (string) $c->status === '1',
                'rxBytes'    => (int) $c->rx_data_used,
                'txBytes'    => (int) $c->tx_data_used,
                'rxMonthly'  => (int) $c->rx_data_used_monthly,
                'txMonthly'  => (int) $c->tx_data_used_monthly,
                'since'      => (string) $c->conn_time_at,
            ];
        }
        usort($clients, fn($a, $b) => ($b['connected'] <=> $a['connected']) ?: ($b['rxBytes'] <=> $a['rxBytes']));
    }
    return [
        'time' => date('c'),
        'onlineCount' => count(array_filter($clients, fn($c) => $c['connected'])),
        'total'       => count($clients),
        'clients'     => $clients,
    ];
}

/** 兼容保留的全量接口: 三源并行 + 各自 TTL 缓存 */
function apiSummary(): array
{
    $xmls = fetchSources(['status1' => 4.0, 'statistics' => 20.0, 'device_management' => 20.0]);
    $st = buildStatus($xmls['status1']);
    $st['traffic'] = buildTraffic($xmls['statistics'], $xmls['status1']);
    unset($st['traffic']['wanRxPackets'], $st['traffic']['wanTxPackets']);
    $dev = buildDevices($xmls['device_management']);
    $st['lan']['connectedCount'] = $dev['onlineCount'];
    $st['clients'] = $dev['clients'];
    return $st;
}

/** 首页主数据 */
function apiStatus(): array
{
    return buildStatus(fetchSources(['status1' => 4.0])['status1']);
}

function apiTraffic(): array
{
    $xmls = fetchSources(['statistics' => 20.0]);
    // 连接时长来自 status1; 有新鲜缓存就带上, 没有就不阻塞
    $statusXml = DataCache::get('status1', 60.0);
    return buildTraffic($xmls['statistics'], $statusXml);
}

function apiDevices(): array
{
    return buildDevices(fetchSources(['device_management' => 20.0])['device_management']);
}

/** 按需拉取: 命中缓存直接用, 过期的并行拉取后写回缓存 */
function fetchSources(array $ttlMap): array
{
    $xmls    = [];
    $pending = [];
    foreach ($ttlMap as $file => $ttl) {
        $xml = DataCache::get($file, $ttl);
        if ($xml !== null) {
            $xmls[$file] = $xml;
        } else {
            $pending[] = $file;
        }
    }
    if ($pending !== []) {
        foreach (MifiSession::i()->fetchXmlParallel($pending) as $file => $xml) {
            $xmls[$file] = $xml;
            DataCache::put($file, $xml);
        }
    }
    return $xmls;
}

/* ===================== WiFi 设置操作 (复用设备原厂 set 接口) ===================== */

function xmlEsc(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

/** WiFi 名称 -> 原厂 UniEncode (UTF-16 四位十六进制) */
function uniEncode(string $s): string
{
    $out = '';
    foreach (mb_str_split($s) as $ch) {
        $out .= sprintf('%04x', mb_ord($ch, 'UTF-8'));
    }
    // 设备自己返回的 ssid 是大写十六进制, 这里对齐
    return strtoupper($out);
}

function wifiAction(array $in): array
{
    $s = MifiSession::i();
    $action = (string) ($in['action'] ?? '');

    switch ($action) {
        case 'ssid':
            $ssid = trim((string) ($in['ssid'] ?? ''));
            if ($ssid === '' || strlen($ssid) > 32) {
                throw new RuntimeException('WiFi 名称需为 1-32 字节（1 个汉字占 3 字节）');
            }
            $xml = '<RGW><wlan_security><ssid>' . uniEncode($ssid) . '</ssid></wlan_security></RGW>';
            $s->postXml('uapxb_wlan_security_settings', $xml);
            DataCache::clear(['status1']);   // 名称变了, 让首页缓存立即过期
            return ['ok' => true, 'message' => 'WiFi 名称已更新，设备 WiFi 将短暂重启'];

        case 'password':
            $pwd = (string) ($in['password'] ?? '');
            if (!preg_match('/^[\x20-\x7e]{8,63}$/', $pwd)) {
                throw new RuntimeException('密码需为 8-63 位字符，且不含中文或空格');
            }
            // 密码节点跟当前加密模式走 (如 WPA2-PSK / Mixed), 与原厂页面一致
            $cur  = sxe($s->fetchXml('uapxb_wlan_security_settings'));
            $mode = trim((string) ($cur->wlan_security->mode ?? ''));
            if ($mode === '' || $mode === 'None') {
                throw new RuntimeException('当前 WiFi 未启用加密，请先在设备后台设置加密方式');
            }
            $node = preg_replace('/[^A-Za-z0-9-]/', '', $mode);
            $xml  = "<RGW><wlan_security><{$node}><key>" . xmlEsc($pwd) . "</key></{$node}></wlan_security></RGW>";
            $s->postXml('uapxb_wlan_security_settings', $xml);
            return ['ok' => true, 'message' => 'WiFi 密码已更新，请用新密码重新连接'];

        case 'security':
            // 名称 + 密码一条请求写完 (同一文件), 设备只重启一次无线
            $ssid  = trim((string) ($in['ssid'] ?? ''));
            $pwdIn = isset($in['password']) ? (string) $in['password'] : '';
            if ($ssid === '') {
                throw new RuntimeException('WiFi 名称不能为空');
            }
            if (strlen($ssid) > 32) {
                throw new RuntimeException('WiFi 名称需为 1-32 字节（1 个汉字占 3 字节）');
            }
            if ($pwdIn !== '' && !preg_match('/^[\x20-\x7e]{8,63}$/', $pwdIn)) {
                throw new RuntimeException('密码需为 8-63 位字符，且不含中文或空格');
            }
            // 设备里 wlan_security 按加密模式分块存 key: 改名要把原密码一起带上, 保证档案完整
            $cur  = sxe($s->fetchXml('uapxb_wlan_security_settings'));
            $mode = trim((string) ($cur->wlan_security->mode ?? ''));
            $node = preg_replace('/[^A-Za-z0-9-]/', '', $mode);
            $encOn = $node !== '' && $mode !== 'None';
            if ($pwdIn !== '' && !$encOn) {
                throw new RuntimeException('当前 WiFi 未启用加密，请先在设备后台设置加密方式');
            }
            $password = $pwdIn !== '' ? $pwdIn : ($encOn ? (string) ($cur->wlan_security->{$node}->key ?? '') : '');
            $renamed  = $ssid !== uniDecode((string) ($cur->wlan_security->ssid ?? ''));
            if (!$renamed && $pwdIn === '') {
                return ['ok' => true, 'unchanged' => true, 'message' => '名称和密码都没有改动'];
            }
            $xml = '<RGW><wlan_security><ssid>' . uniEncode($ssid) . '</ssid>';
            if ($encOn && $password !== '') {
                $xml .= "<mode>{$node}</mode><{$node}><key>" . xmlEsc($password) . "</key></{$node}>";
            }
            $xml .= '</wlan_security></RGW>';
            $s->postXml('uapxb_wlan_security_settings', $xml);
            DataCache::clear(['status1', 'uapxb_wlan_security_settings']);
            if ($pwdIn !== '') {
                return ['ok' => true, 'message' => $renamed
                    ? 'WiFi 名称和密码已更新，请用新的名称和密码重新连接'
                    : 'WiFi 密码已更新，请用新密码重新连接'];
            }
            return ['ok' => true, 'message' => 'WiFi 名称已更新，设备无线将短暂重启'];

        case 'toggle':
            // 只接受显式 '0' / '1'。不做"取反"也不给默认值: 关掉无线后无法远程回滚,
            // 早前 UI 用 wifi.enabled 反推, status 缺失时会"想关反而开了"。
            $enable = $in['enable'] ?? null;
            if ($enable !== '0' && $enable !== '1') {
                throw new RuntimeException('toggle 需要显式 enable="0"（关闭）或 "1"（开启）');
            }
            $xml = "<RGW><wlan_settings><wlan_enable>{$enable}</wlan_enable></wlan_settings></RGW>";
            $s->postXml('uapxb_wlan_basic_settings', $xml);
            DataCache::clear(['status1']);
            return ['ok' => true, 'message' => $enable === '1' ? 'WiFi 已开启' : 'WiFi 已关闭'];

        case 'autooff':
            // 0 = 关闭「无客户端自动关闭」; 10~60 = 空闲多少分钟后自动关无线 (与原厂校验一致)
            $minutes = (int) ($in['minutes'] ?? -1);
            if (!($minutes === 0 || ($minutes >= 10 && $minutes <= 60))) {
                throw new RuntimeException('自动关闭时间需为 10 - 60 分钟，或设为关闭');
            }
            // 与原厂 SetWifiSleepTime 一致: wifi_sleep_action=1 是"立即生效"标志, 少发它写入不生效
            $xml = "<RGW><wlan_settings><wifi_sleep_time>{$minutes}</wifi_sleep_time>"
                 . "<wifi_sleep_action>1</wifi_sleep_action></wlan_settings></RGW>";
            $s->postXml('uapxb_wlan_basic_settings', $xml);
            DataCache::clear(['uapxb_wlan_basic_settings']);
            return ['ok' => true, 'message' => $minutes === 0
                ? '已关闭「无客户端自动关闭」'
                : "已设为空闲 {$minutes} 分钟后自动关闭无线"];
    }

    throw new RuntimeException('不支持的操作');
}

/* ===================== 整机动作: 重启 / 关闭设备 =====================
 * 原厂「路由器」页签里的两项 (xml/ui_mifi.xml):
 *     mReboot         -> file=reset       (重启路由器)
 *     mPowerOffRouter -> file=power_off   (关闭路由器, 仅 devicetype=MIFI 才显示)
 * 触发方式是 GET 一下这个文件, 不带 XML body。关机后设备彻底断电, 只能按电源键开机。
 */
const DEVICE_ACTIONS = ['reboot' => 'reset', 'poweroff' => 'power_off'];

function routerAction(array $in): array
{
    $kind = (string) ($in['action'] ?? '');
    if (!isset(DEVICE_ACTIONS[$kind])) {
        throw new RuntimeException('不支持的操作');
    }
    // 关机之后只能按机身电源键开机, 服务端再拦一道, 避免误调或脚本扫到就直接关机
    if ($kind === 'poweroff' && ($in['confirm'] ?? null) !== true) {
        throw new RuntimeException('关闭设备需要显式确认');
    }

    MifiSession::i()->triggerAction(DEVICE_ACTIONS[$kind]);
    DataCache::clear(['status1', 'statistics', 'device_management', 'uapxb_wlan_basic_settings']);

    return [
        'ok'      => true,
        'action'  => $kind,
        'message' => $kind === 'reboot'
            ? '重启指令已发出，设备正在重启（约 1 分钟恢复）'
            : '关机指令已发出。设备已断电，需长按机身上的电源键才能重新开机',
    ];
}

/* ===================== SIM 卡设置 (esim 卡槽切换, 与原厂「eSIM」页同源) ===================== */

const SIM_SLOTS = [0 => '卡1', 1 => '卡2', 2 => '卡3'];   // 原厂下拉选项 ltSIM0-2

function apiSimInfo(): array
{
    $xmls = fetchSources(['esim' => 5.0, 'deviceinfo' => 600.0]);
    $esim = sxe($xmls['esim']);
    $pwdRequired = '0';
    if (isset($xmls['deviceinfo'])) {
        $pwdRequired = txt(sxe($xmls['deviceinfo']), 'sysinfo/simmuxpwd', '0');
    }
    $slots = [];
    foreach (SIM_SLOTS as $v => $label) {
        $slots[] = ['value' => $v, 'label' => $label];
    }
    return [
        'time'        => date('c'),
        'current'     => (int) txt($esim, 'esim/simid', '-1'),
        'pwdRequired' => $pwdRequired === '1',
        'slots'       => $slots,
    ];
}

function simAction(array $in): array
{
    $slot = $in['slot'] ?? null;
    if (!is_numeric($slot) || !array_key_exists((int) $slot, SIM_SLOTS)) {
        throw new RuntimeException('请选择有效的卡槽（卡1 / 卡2 / 卡3）');
    }
    $slot = (int) $slot;
    $info = apiSimInfo();
    $pw   = trim((string) ($in['pw'] ?? ''));
    if ($info['pwdRequired'] && ($pw === '' || strlen($pw) > 12)) {
        throw new RuntimeException('请输入 SIM 切换密码（不超过 12 位）');
    }
    // 与原厂 objeSIM.onPost 相同的下发结构
    $xml = '<RGW><esim><simmode>' . $slot . '</simmode>'
        . ($info['pwdRequired'] ? '<pw>' . xmlEsc($pw) . '</pw>' : '')
        . '</esim></RGW>';
    $resp = MifiSession::i()->postXml('esim', $xml);
    // 原厂 eSimCheckCmdStatus: 响应 cmd_status=pw 表示密码错误
    if (str_contains($resp, '<cmd_status>pw</cmd_status>')) {
        throw new RuntimeException('密码错误，请重试');
    }
    DataCache::clear(['esim', 'status1', 'statistics', 'device_management']);   // 换卡后运营商/ICCID/流量都会变
    return ['ok' => true, 'message' => 'SIM 卡槽已切换为 ' . SIM_SLOTS[$slot] . '，网络将在几秒到几十秒内自动恢复'];
}

/* ===================== 频段锁定 (customconfig, 与原厂「频段」页同源) ===================== */

/**
 * 频段掩码编码 (原厂 setBand 同款):
 *   ltebandl  bit i -> FDD 频段 B(i+1)    (B1-B32)
 *   ltebandh  bit i -> TDD 频段 B(i+33)   (B33-B64)
 *   ltebandext bit i -> FDD 频段 B(i+65)  (B65-B96)
 */
/** 从 customconfig XML 解析当前驻留频段描述 */
function bandCurrentFromXml(string $xml): ?string
{
    $cc  = sxe($xml);
    $cur = (int) txt($cc, 'customconfig/band_current', '0');
    $act = (int) txt($cc, 'customconfig/act_current', '0');
    if ($act === 7 && $cur > 0) {
        return ($cur >= 33 && $cur <= 64 ? 'TDD' : 'FDD') . ' B' . $cur;
    }
    if (in_array($act, [2, 4, 5, 6, 8], true) && $cur > 1) {
        return 'UMTS B' . ($cur - 1);
    }
    return null;
}

function apiBandInfo(): array
{
    $xmls = fetchSources(['customconfig' => 5.0]);
    $cc = sxe($xmls['customconfig']);

    // band_factory 逗号分隔: [3]=支持的 ltebandh, [4]=ltebandl, [8]=ltebandext
    $parts = explode(',', txt($cc, 'customconfig/band_factory'));
    $supH = (int) ($parts[3] ?? 0);
    $supL = (int) ($parts[4] ?? 0);
    $supE = (int) ($parts[8] ?? 0);
    $setH = (int) txt($cc, 'customconfig/ltebandh', '0');
    $setL = (int) txt($cc, 'customconfig/ltebandl', '0');
    $setE = (int) txt($cc, 'customconfig/ltebandext', '0');

    $bands = [];
    for ($i = 0; $i < 32; $i++) {
        foreach ([[&$supL, &$setL, 1, 'FDD'], [&$supH, &$setH, 33, 'TDD'], [&$supE, &$setE, 65, 'FDD']] as [$sup, $set, $base, $type]) {
            if ($sup & (1 << $i)) {
                $bands[] = ['band' => $base + $i, 'type' => $type, 'enabled' => ($set & (1 << $i)) !== 0];
            }
        }
    }
    usort($bands, fn($a, $b) => $a['band'] <=> $b['band']);

    // 当前驻留频段 (原厂 updateCurrent 同款判断)
    $current = bandCurrentFromXml($xmls['customconfig']);

    return [
        'time'    => date('c'),
        'bands'   => $bands,
        'masks'   => ['h' => $setH, 'l' => $setL, 'ext' => $setE],
        'current' => $current,
    ];
}

/** 无线基础配置: 无客户端自动关闭 (status1 里没有该字段, 单独读一次, 20s 缓存足够) */
function apiWlanBasic(): array
{
    $xmls = fetchSources(['uapxb_wlan_basic_settings' => 20.0]);
    return buildWlanBasic($xmls['uapxb_wlan_basic_settings']);
}

function bandAction(array $in): array
{
    $info = apiBandInfo();
    $sel  = array_map('intval', (array) ($in['bands'] ?? []));
    $h = 0; $l = 0; $e = 0;
    foreach ($info['bands'] as $b) {
        if (in_array($b['band'], $sel, true)) {
            if ($b['band'] <= 32) {
                $l |= 1 << ($b['band'] - 1);
            } elseif ($b['band'] <= 64) {
                $h |= 1 << ($b['band'] - 33);
            } else {
                $e |= 1 << ($b['band'] - 65);
            }
        }
    }
    if ($h === 0 && $l === 0 && $e === 0) {
        throw new RuntimeException('请至少选择一个频段');
    }
    $xml = "<RGW><customconfig><ltebandh>{$h}</ltebandh><ltebandl>{$l}</ltebandl><ltebandext>{$e}</ltebandext></customconfig></RGW>";
    MifiSession::i()->postXml('customconfig', $xml);
    DataCache::clear(['customconfig']);
    return ['ok' => true, 'message' => '频段设置已保存，设备将只在所选频段上驻网'];
}

/** 流量套餐总量设置: 写入设备原生字段 total_available_month (0 = 清除/不限量) */
function quotaAction(array $in): array
{
    $gb = $in['quotaGb'] ?? null;
    if (!is_numeric($gb) || (float) $gb < 0 || (float) $gb > 100000) {
        throw new RuntimeException('流量总量需为 0 - 100000 GB（0 表示不限量）');
    }
    $bytes = (int) floor((float) $gb * 1073741824);
    // 与原厂流量管理页一致: 直接下发 total_available_month 字节数
    $xml = "<RGW><statistics><WanStatistics><total_available_month>{$bytes}</total_available_month></WanStatistics></statistics></RGW>";
    MifiSession::i()->postXml('statistics', $xml);
    DataCache::clear(['statistics']);
    return ['ok' => true, 'message' => $bytes === 0
        ? '已清除流量总量设置（不限量）'
        : '流量总量已设置为 ' . rtrim(rtrim(number_format((float) $gb, 2), '0'), '.') . ' GB'];
}

/* ===================== 套餐总流量查询 (迈高讯发卡平台, 手动刷新不轮询) ===================== */

const MGX_HOST = 'http://xmgxx.maigaoxun.com/kyhl-weixin-1.0';

/** 平台 HTTP 请求, 返回 [解析后的JSON|null, Set-Cookie] */
function mgxRequest(string $path, ?string $cookie = null): array
{
    $ch = curl_init(MGX_HOST . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_HTTPHEADER     => $cookie ? ['Cookie: ' . $cookie] : [],
    ]);
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('流量平台请求失败: ' . $err);
    }
    $hSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $headers = [];
    foreach (preg_split('/\r?\n/', substr((string) $raw, 0, $hSize)) ?: [] as $line) {
        $idx = strpos($line, ':');
        if ($idx !== false) {
            $headers[trim(substr($line, 0, $idx))] = trim(substr($line, $idx + 1));
        }
    }
    $body = substr((string) $raw, $hSize);
    $start = strpos($body, '{');
    $json  = $start !== false ? json_decode(substr($body, $start), true) : null;
    return [$json, $headers['Set-Cookie'] ?? ''];
}

/**
 * 查询套餐总流量: login.do 建会话 -> findCardInfo.do 取套餐。
 * 数据口径与平台页面一致: flowSize / totalBytesCnt 单位均为 MB。
 */
function apiRemoteTraffic(bool $refresh = false): array
{
    $card = deviceConfig()['mgx_card'];
    if ($card === '') {
        throw new RuntimeException('未配置发卡平台设备号: 请在 config.local.php 增加 "mgx_card" 或设置环境变量 WIFI_MGX_CARD');
    }
    if (!$refresh) {
        $cached = DataCache::get('mgx_traffic', 120.0);
        if ($cached !== null) {
            $out = json_decode($cached, true);
            if (is_array($out)) {
                $out['cached'] = true;
                return $out;
            }
        }
    }

    [$login, $cookie] = mgxRequest('/card/login.do?responseFunction=cb&iccidMark=' . urlencode($card));
    if (!is_array($login) || ($login['code'] ?? '') !== '0') {
        throw new RuntimeException('发卡平台登录失败: ' . (is_array($login) ? ($login['msg'] ?? '未知错误') : '响应异常'));
    }
    if ($cookie === '' || !str_contains($cookie, '=')) {
        throw new RuntimeException('发卡平台未返回会话');
    }
    [$info] = mgxRequest('/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb&skipGift=true&rfm=' . mt_rand() / mt_getrandmax(), explode(';', $cookie)[0]);
    if (!is_array($info) || ($info['code'] ?? '') !== '0') {
        throw new RuntimeException('发卡平台查询失败: ' . (is_array($info) ? ($info['msg'] ?? '未知错误') : '响应异常'));
    }

    $entity = $info['entity'] ?? [];
    // 总量 = 当前生效套餐列表 flowSize 之和(与平台页面的加总口径一致), 列表为空时退回 entity.flowSize
    $lives  = $info['cardLiftList'] ?? [];
    $totalMb = (float) ($entity['flowSize'] ?? 0);
    $packages = [];
    if ($lives) {
        $totalMb = 0;
        foreach ($lives as $life) {
            $size = (float) ($life['flowSize'] ?? 0);
            $totalMb += $size;
            $packages[] = [
                'name'   => (string) ($life['mealName'] ?? '套餐'),
                'sizeGB' => round($size / 1024, 2),
            ];
        }
    }
    $usedMb = (float) ($entity['totalBytesCnt'] ?? 0);

    $out = [
        'time'        => date('c'),
        'card'        => $card,
        'package'     => (string) ($entity['cardPackage'] ?? ''),
        'status'      => (string) ($entity['statusStr'] ?? ''),
        'expireDate'  => (string) ($entity['expireDate'] ?? ''),
        'totalBytes'  => (int) round($totalMb * 1048576),
        'usedBytes'   => (int) round($usedMb * 1048576),
        'leftBytes'   => (int) round(max(0, $totalMb - $usedMb) * 1048576),
        'unlimited'   => $totalMb <= 0,          // flowSize 空/0 时平台显示为不限量
        'packages'    => $packages,
    ];
    DataCache::put('mgx_traffic', json_encode($out, JSON_UNESCAPED_UNICODE));
    $out['cached'] = false;
    return $out;
}

/* ===================== 页面与接口路由 (配合 php -S 使用) ===================== */

function jsonOut(array $payload, int $code = 200): bool
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return true;
}

/** 本机局域网 IP (用于提示手机访问地址) */
function lanIp(): string
{
    static $ip = null;
    if ($ip === null) {
        $ip = '';
        foreach (['en0', 'en1'] as $if) {
            $out = trim((string) @shell_exec("ipconfig getifaddr {$if} 2>/dev/null"));
            if ($out !== '' && filter_var($out, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
                $ip = $out;
                break;
            }
        }
    }
    return $ip;
}

/** 输出页面 HTML; 命中较新缓存时注入 window.__BOOT__ 让首屏 0ms 出数据 (纯读缓存, 不触达设备) */
function pageOut(string $name, ?callable $bootProvider): bool
{
    $file = __DIR__ . '/public/' . $name;
    $html = @file_get_contents($file);
    if ($html === false) {
        http_response_code(404);
        echo 'Not Found';
        return true;
    }
    if ($bootProvider !== null) {
        try {
            $boot = $bootProvider();
            if ($boot !== null) {
                $inject = '<script>window.__BOOT__='
                    . json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    . ';</script></head>';
                $html = str_replace('</head>', $inject, $html);
            }
        } catch (Throwable) {
            // 注入失败不影响页面输出, 前端会自行请求
        }
    }
    $lan = lanIp();
    if ($lan !== '') {
        $html = str_replace('</head>',
            '<script>window.__LAN_IP__=' . json_encode($lan) . ';</script></head>', $html);
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    echo $html;
    return true;
}

$uri    = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if (PHP_SAPI !== 'cli-server') {
    return;   // CLI (如 php -r 调试) 只加载类与函数, 不执行路由
}

if ($uri === '/api/summary') {
    try {
        return jsonOut(apiSummary());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/status') {
    try {
        return jsonOut(apiStatus());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/traffic') {
    try {
        return jsonOut(apiTraffic());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/devices') {
    try {
        return jsonOut(apiDevices());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/remote-traffic') {
    $refresh = ($_GET['refresh'] ?? '') === '1';
    try {
        return jsonOut(apiRemoteTraffic($refresh));
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/traffic/quota' && $method === 'POST') {
    $in = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($in)) {
        return jsonOut(['ok' => false, 'error' => '请求格式错误'], 400);
    }
    try {
        return jsonOut(quotaAction($in));
    } catch (Throwable $e) {
        return jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
    }
}
if ($uri === '/api/sim') {
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($in)) {
            return jsonOut(['ok' => false, 'error' => '请求格式错误'], 400);
        }
        try {
            return jsonOut(simAction($in));
        } catch (Throwable $e) {
            return jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }
    try {
        return jsonOut(apiSimInfo());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/band') {
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($in)) {
            return jsonOut(['ok' => false, 'error' => '请求格式错误'], 400);
        }
        try {
            return jsonOut(bandAction($in));
        } catch (Throwable $e) {
            return jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }
    try {
        return jsonOut(apiBandInfo());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}
if ($uri === '/api/router') {
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($in)) {
            return jsonOut(['ok' => false, 'error' => '请求格式错误'], 400);
        }
        try {
            return jsonOut(routerAction($in));
        } catch (Throwable $e) {
            return jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }
    return jsonOut(['ok' => false, 'error' => '请用 POST 调用'], 405);
}

if ($uri === '/api/wifi') {
    if ($method === 'POST') {
        $in = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($in)) {
            return jsonOut(['ok' => false, 'error' => '请求格式错误'], 400);
        }
        try {
            return jsonOut(wifiAction($in));
        } catch (Throwable $e) {
            return jsonOut(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }
    try {
        return jsonOut(apiWlanBasic());
    } catch (Throwable $e) {
        return jsonOut(['error' => $e->getMessage()], 502);
    }
}

if ($uri === '/' || $uri === '/index.html') {
    // 首页只依赖 status1; 入口卡片上的流量数字用旧缓存锦上添花, 绝不触发设备请求
    return pageOut('index.html', function (): ?array {
        $xml = DataCache::get('status1', 45.0);
        if ($xml === null) {
            return null;
        }
        $boot = buildStatus($xml);
        $statsXml = DataCache::get('statistics', 300.0);
        if ($statsXml !== null) {
            $boot['trafficOverview'] = buildTraffic($statsXml, DataCache::get('status1', 60.0));
        }
        $esimXml = DataCache::get('esim', 300.0);
        if ($esimXml !== null) {
            $boot['simOverview'] = ['current' => (int) txt(sxe($esimXml), 'esim/simid', '-1')];
        }
        $bandXml = DataCache::get('customconfig', 300.0);
        if ($bandXml !== null) {
            $boot['bandOverview'] = ['current' => bandCurrentFromXml($bandXml)];
        }
        return $boot;
    });
}
if ($uri === '/traffic' || $uri === '/traffic.html') {
    return pageOut('traffic.html', function (): ?array {
        $xml = DataCache::get('statistics', 120.0);
        return $xml === null ? null : buildTraffic($xml, DataCache::get('status1', 60.0));
    });
}
if ($uri === '/devices' || $uri === '/devices.html') {
    return pageOut('devices.html', function (): ?array {
        $xml = DataCache::get('device_management', 60.0);
        return $xml === null ? null : buildDevices($xml);
    });
}

// 其余交给内置服务器返回 public/ 下的静态文件 (app.css / app.js 等)
return false;
