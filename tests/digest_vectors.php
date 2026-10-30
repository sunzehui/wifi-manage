<?php

declare(strict_types=1);

/**
 * Digest 固定向量测试 (无需设备): 校验 server.php 的登录计算与 core.js 的 loginRequest
 * 使用同一组期望值。tests/core.test.js 中硬编码了相同常量，两边任一漂移都会失败。
 */
require __DIR__ . '/../server.php';

$fails = 0;
function check(string $name, string $expected, string $actual): void
{
    global $fails;
    if ($expected === $actual) {
        echo "ok   {$name}\n";
        return;
    }
    $fails++;
    fwrite(STDERR, "FAIL {$name}\n  expected: {$expected}\n  actual:   {$actual}\n");
}

check('md5(HA1)', 'bfda623baa0a7c65c953803e117b3763', md5('admin:Highwmg:testpass'));
check('md5(HA2 protected.cgi)', '202fe3ae6688ea0a29cec56f47556821', md5('GET:/cgi/protected.cgi'));
check('md5(HA2 xml_action.cgi)', '905231dd8a834adf460e748aa0b216e3', md5('GET:/cgi/xml_action.cgi'));

$cfg       = ['user' => 'admin', 'pass' => 'testpass'];
$challenge = ['realm' => 'Highwmg', 'nonce' => '6028365', 'qop' => 'auth'];
[$path, $auth] = digestLoginRequest($cfg, $challenge, '0123456789abcdef');

check('login path', '/login.cgi?Action=Digest&username=admin&realm=Highwmg&nonce=6028365'
    . '&response=bc91a0a5a0013b9d05fdbe6a8eb1c7bb&qop=auth&cnonce=0123456789abcdef&temp=asr', $path);
check('Authorization header', 'Digest username="admin", realm="Highwmg", nonce="6028365"'
    . ', uri="/cgi/xml_action.cgi", response="23192d08056d3589140da39c89c238a8"'
    . ', qop=auth, nc=00000001, cnonce="0123456789abcdef"', $auth);

exit($fails === 0 ? 0 : 1);
