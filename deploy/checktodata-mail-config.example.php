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
    // SMTP server — implicit TLS on 465, per the Donweb mailbox settings.
    'host'     => 'a0161088.ferozo.com',
    'port'     => 465,

    // Mailbox credentials.
    'username' => 'info@checktodata.com',
    'password' => 'PUT-THE-MAILBOX-PASSWORD-HERE',

    // Envelope sender. Must stay on your own domain so SPF/DKIM pass — the visitor's
    // address goes into Reply-To instead, which contact.php handles for you.
    'from'      => 'info@checktodata.com',
    'from_name' => 'CheckToData Web',

    // Where submissions are delivered.
    'to'       => 'info@checktodata.com',
];
