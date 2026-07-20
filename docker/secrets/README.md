# Secrets

These files are optional. Place them in this directory only when you need to
supply a stable master key or an emergency file certificate:

- `nginx_manager_master_key`: stable 32-byte random master key.
- `manager.crt` / `manager.key`: optional legacy / emergency manager TLS material
  (not required for greenfield). Prefer Settings → Manager + DNS-01 once bound.

## Greenfield (recommended)

You can start without `MANAGER_HOST`, `MANAGER_URL`, or manager certificate files.
The container serves bootstrap HTTP on `127.0.0.1` / `localhost` (mapped host
ports 80→8080). Complete setup in the panel, then bind a public hostname under
**Settings → Manager**.

If the master key is omitted, the container generates a persistent 32-byte key
under the `/data/secrets` volume so restarts of the same volume keep encryption
stable.

## Legacy / upgrade seed

Setting `MANAGER_HOST` (and optionally `MANAGER_URL` + file TLS) seeds a manager
row on first boot of the new version. After migration, the published manager
snapshot in SQLite is the source of truth — env is no longer required.

## Master key

Generate a master key once when you want to pin it yourself:

```sh
openssl rand -out nginx_manager_master_key 32
```

Do not regenerate a production master key when rebuilding or restarting the
container. Never commit secret files.

The process runs as UID/GID `10001`. On native Linux, make host-provided files
readable only by that identity:

```sh
sudo chown 10001:10001 nginx_manager_master_key
sudo chmod 0400 nginx_manager_master_key
# optional emergency TLS:
# sudo chown 10001:10001 manager.crt manager.key
# sudo chmod 0400 manager.crt manager.key
```
