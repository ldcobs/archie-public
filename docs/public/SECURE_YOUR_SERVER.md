# Secure your server first

> **This is a hard requirement, not a suggestion.** Archie protects your users'
> traffic, but Archie itself runs **on your server**. If the server is
> compromised, Archie cannot protect anything — it becomes a risk instead of a
> safeguard. **The security of your VPN depends entirely on the security of the
> VPS gateway(s) that host it.** Do the steps below *before* you install.

These are the recommended best practices for standing up a server that will run
Archie. They take about ten minutes and only need to be done once per server.

## Why this matters

Archie runs the VPN engines (Xray/Reality, Hysteria2, WireGuard) and the
management dashboard directly on your VPS. Whoever controls that server controls
the VPN: they can read your configuration, your keys, your user list, and your
users' traffic. So your VPN is only ever as secure as the weakest server hosting
it. A gateway left on a default root password is not "an Archie box with a small
gap" — it is an open door to everything Archie is meant to protect.

If you run more than one gateway, **every** gateway must meet this bar.

---

## 1. Create the server with an SSH key — never a password

When you create the VPS, add your **SSH public key** so you log in with a key
instead of a password. Password logins can be brute-forced; keys cannot.

Provider guides (add your key at creation time):

- **Hostinger** — https://www.hostinger.com/tutorials/how-to-set-up-ssh-keys
- **DigitalOcean** — https://docs.digitalocean.com/products/droplets/how-to/add-ssh-keys/
- **Hetzner Cloud** — https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/
- **Vultr** — https://docs.vultr.com/how-to-use-ssh-with-vultr-cloud-servers
- **AWS EC2** — https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html

Don't have a key yet? Create one on your laptop, then paste the **public** half
into your provider:

```bash
ssh-keygen -t ed25519            # press Enter through the prompts
cat ~/.ssh/id_ed25519.pub        # copy this line into your provider's "SSH keys"
```

Log in to confirm the key works:

```bash
ssh root@your-server-ip
```

Many providers (e.g. DigitalOcean) already turn off password login when you
create a server with an SSH key — in that case Step 2 is mostly done, but verify
it anyway.

## 2. Turn off password and root-password logins

So that **only your key** can log in, disable password authentication:

```bash
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

> ⚠️ **Before you close your current session, open a *new* SSH connection in a
> second terminal to confirm your key still works.** If it does, you're safe to
> disconnect. This prevents locking yourself out.
>
> On some cloud images the setting is also kept in a drop-in file under
> `/etc/ssh/sshd_config.d/`. If password login still works after the commands
> above, check that folder for a `PasswordAuthentication yes` line and change it
> there too, then restart SSH again.

## 3. Turn on automatic security updates

So the server patches known vulnerabilities on its own:

```bash
sudo apt update
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # choose "Yes"
```

## 4. What Archie handles for you

You do **not** need to configure these yourself — the installer does it:

- **Firewall (UFW).** Only the ports Archie actually needs are opened (SSH,
  Reality, Hysteria2, etc.); everything else is blocked.
- **fail2ban.** Repeated failed connections get the offending IP banned.

---

## Checklist before you install

- [ ] You log in with an **SSH key**, not a password
- [ ] **Password login is disabled** (`PasswordAuthentication no`)
- [ ] **Root password login is disabled** (`PermitRootLogin prohibit-password`)
- [ ] **Automatic security updates are on**
- [ ] Every gateway you run meets all of the above

Once these are done, continue with the install in the
[main README](../../README.md#install).
