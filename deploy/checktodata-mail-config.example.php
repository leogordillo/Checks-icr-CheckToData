<?php
/**
 * Credentials template for public/contact.php.
 *
 * DO NOT commit a filled-in copy of this file, and DO NOT upload it inside the web
 * root. Copy it, fill in the password, rename it to `checktodata-mail-config.php`,
 * and upload it ONE DIRECTORY ABOVE the folder that serves the site.
 *
 * Typical Donweb/ferozo layout, where the site is served from public_html/:
 *
 *   /home/xxxxx/
 *   ├── checktodata-mail-config.php   ← here (not reachable over HTTP)
 *   └── public_html/
 *       ├── index.html
 *       ├── contact.php
 *       └── main-XXXXXXXX.js
 *
 * contact.php looks one and two levels up from itself, so that placement is found
 * automatically with no code change.
 */

declare(strict_types=1);

return [
    /**
     * SMTP relay.
     *
     * On this hosting the EXTERNAL mail server (a0161088.ferozo.com) refuses
     * connections coming from Argentina/South America with "550 5.7.1
     * Blacklisted", so the local relay is what actually works:
     *
     *     'host' => 'localhost', 'port' => 25, 'secure' => 'none', 'auth' => false
     *
     * Point it at the external server only if that block is lifted. Run
     * smtp-check.php (with debug on) to see which combinations connect.
     */
    'host'     => 'localhost',
    'port'     => 25,

    /**
     * How the connection is encrypted:
     *   'ssl'  → implicit TLS, encrypted from the start   (port 465, the default)
     *   'tls'  → plain connect upgraded via STARTTLS      (port 587)
     *   'none' → no encryption; only sane for a localhost relay
     *
     * If the host blocks outbound SMTP to the outside world, a local relay
     * ('host' => 'localhost', 'port' => 25, 'secure' => 'none') often works.
     */
    'secure'   => 'none',

    /**
     * Whether the relay requires credentials. A local relay normally accepts mail
     * from its own machine unauthenticated; answering AUTH there aborts an
     * otherwise fine session. Set true when pointing at an authenticated server.
     */
    'auth'     => false,

    /**
     * Certificate validation for the SMTP connection. Irrelevant when 'secure' is
     * 'none'.
     *
     * Shared hosting frequently ships PHP without a usable CA bundle, or presents a
     * certificate that does not match the mail host name. Either case fails the
     * handshake with an empty error and errno 0. Setting this to false skips the
     * validation; the connection stays encrypted, it is just not authenticated.
     */
    'verify_cert' => true,

    // Mailbox credentials, used only when 'auth' is true. A 535 in the logs means
    // this no longer matches the password the mailbox actually has — the usual
    // cause after rotating it.
    'username' => 'info@checktodata.com',
    'password' => 'PUT-THE-MAILBOX-PASSWORD-HERE',

    /**
     * Diagnostics. With true, a failed send returns the technical SMTP error in
     * the JSON response, so the cause is visible from the browser instead of
     * having to dig through the hosting error log.
     *
     * Turn it OFF once things work: it exposes server internals to anyone who
     * submits the form.
     */
    'debug'    => false,

    // Registros por hora y por IP admitidos por register.php. Subilo mientras
    // configurás el envío, para no bloquearte a vos mismo probando.
    'rate_limit_register' => 5,

    // Envelope sender. Must stay on your own domain so SPF/DKIM pass — the visitor's
    // address goes into Reply-To instead, which contact.php handles for you.
    'from'      => 'info@checktodata.com',
    'from_name' => 'CheckToData Web',

    // Where submissions are delivered.
    'to'       => 'info@checktodata.com',
];
