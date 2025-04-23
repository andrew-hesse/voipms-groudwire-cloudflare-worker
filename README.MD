# Balance checker for voip.ms at Acrobits Groundwire iOS app

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/andrew-hesse/voipms-groudwire-cloudflare-worker)

Cloudflare Worker to expose [voip.ms](voip.ms) API in [Groundwire format](https://doc.acrobits.net/api/client/balance_checker.html). Build it as a side project to practice knowledge in Github, Node, Express, etc. If you see any opportunity for optimization - pull requests are welcome.

```mermaid
sequenceDiagram
    participant GA as Groundwire App
    participant D as Cloudflare Worker
    participant A as voip.ms API
    GA->>D: Check balance
    Note over D: Authenticate <br/> against voip.ms API
    D->>A: Issue API call to voip.ms
    Activate A
    A->>D: Return balance as float (12.123432)
    Deactivate A
    Note over D: Process number and add currency
    D->>GA: Return formatted balance
```

# Deployment

## voip.ms

1. Go to [voip.ms API page](https://voip.ms/m/api.php) and configure API password.
2. Enable API by clicking `Enable/Disable API`. Make sure that it shows `Enabled`
3. Configure IP address of the host where your Docker container will be deployed. If you don't have static IP you can configure `0.0.0.0` to allow access from all IPs, **but it presents serious security risk**.

P.S. After lengthy conversation with voip.ms support team, I could not find the way to permit Cloudflare ranges access only.

## Cloudflare

Add variable `VOIP_PASSWORD` as a secret via `wrangler secret put VOIP_PASSWORD`
(You have to have `wrangler` installed. You still will need it installed to deploy the CF Worker)

## Groundwire iOS App

Configure in Groundwire settings

`Settings -> Select voip.ms number -> Advanced Settings -> Web Services -> Balance Checker`

# Groundwire screenshot

![This is an image](/pictures/groundwire.PNG)
