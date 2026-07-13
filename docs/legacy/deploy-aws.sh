#!/bin/bash
set -euo pipefail

# --- Config ---
REGION="eu-central-1"
INSTANCE_TYPE="t3.micro"
KEY_NAME="certbuzz-key"
SG_NAME="certbuzz-sg"
INSTANCE_NAME="certbuzz"
UBUNTU_AMI="ami-0084a47cc718c111a"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="test.jitter.eu"
EMAIL="admin@jitter.eu"
REMOTE_DIR="certbuzz"
PM2_APP="certbuzz"
SSH_KEY="$HOME/.ssh/${KEY_NAME}.pem"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# --- Helpers ---
log()  { echo "--- $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }
ssh_() { ssh -i "$SSH_KEY" $SSH_OPTS "ubuntu@$IP" "$@"; }

# --- Ensure security group + rules (idempotent, runs every deploy) ---
ensure_sg() {
  SG_ID=$(aws ec2 describe-security-groups --group-names "$SG_NAME" --region "$REGION" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "")
  if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
    SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" --description "CertBuzz" \
      --region "$REGION" --query 'GroupId' --output text)
    log "Created security group $SG_ID"
  fi

  # Ensure SSH (22), HTTP (80), HTTPS (443) are open — re-add any that were removed
  for port in 22 80 443; do
    aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0 --region "$REGION" 2>/dev/null || true
  done
}

# --- Resolve or provision instance ---
resolve_instance() {
  local info
  info=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,stopped" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].[InstanceId,State.Name,PublicIpAddress]' \
    --output text 2>/dev/null) || true

  INSTANCE_ID=$(echo "$info" | awk '{print $1}')
  local state=$(echo "$info" | awk '{print $2}')

  if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
    log "Provisioning new EC2 instance..."
    provision_instance
  elif [[ "$state" == "stopped" ]]; then
    log "Starting stopped instance $INSTANCE_ID..."
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
  fi

  IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
  log "Instance $INSTANCE_ID @ $IP"
}

provision_instance() {
  # SSH key
  if [[ ! -f "$SSH_KEY" ]]; then
    aws ec2 create-key-pair --key-name "$KEY_NAME" --region "$REGION" \
      --query 'KeyMaterial' --output text > "$SSH_KEY"
    chmod 400 "$SSH_KEY"
  fi

  # Launch
  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$UBUNTU_AMI" --count 1 --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --region "$REGION" --query 'Instances[0].InstanceId' --output text)
  log "Launched $INSTANCE_ID"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
  FIRST_DEPLOY=true
}

wait_for_ssh() {
  log "Waiting for SSH..."
  for _ in {1..30}; do
    ssh_ true 2>/dev/null && return
    sleep 3
  done
  die "SSH timeout"
}

install_runtime() {
  log "Installing Node.js, PM2, Nginx, Certbot..."
  ssh_ bash <<'EOF'
set -e
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential nginx certbot python3-certbot-nginx
sudo npm i -g pm2
EOF
}

sync_files() {
  log "Syncing files..."
  rsync -az --delete \
    --exclude node_modules --exclude .git --exclude dist \
    --exclude database.db --exclude .env --exclude '*.sh' \
    -e "ssh -i $SSH_KEY $SSH_OPTS" \
    "$APP_DIR/" "ubuntu@$IP:~/$REMOTE_DIR/"
}

build_and_restart() {
  log "Building & restarting..."
  ssh_ bash <<EOF
set -e
cd ~/$REMOTE_DIR

# .env (only create if missing)
if [ ! -f .env ]; then
  cat > .env <<ENVEOF
DOZENT_PASSWORD=Dozent128
PORT=8000
HOST=0.0.0.0
NODE_ENV=production
ALLOWED_ORIGINS=https://$DOMAIN,http://$DOMAIN
ENVEOF
fi

cd server && npm ci --silent && npm run build
cd ../client && npm ci --silent && npm run build
cd ../server

pm2 delete $PM2_APP 2>/dev/null || true
pm2 start dist/server.js --name $PM2_APP
pm2 save
sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true
EOF
}

configure_nginx() {
  log "Configuring Nginx + SSL..."
  ssh_ DOMAIN="$DOMAIN" EMAIL="$EMAIL" bash <<'EOF'
set -e

PROXY_SETTINGS='
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_set_header X-Real-IP  $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
'

# Step 1: HTTP-only config (needed for certbot on first run)
sudo tee /etc/nginx/sites-available/certbuzz >/dev/null <<NGINX
upstream certbuzz_app {
    server localhost:8000;
    keepalive 64;
}
server {
    listen 80;
    server_name $DOMAIN;
$PROXY_SETTINGS
    location /            { proxy_pass http://certbuzz_app; }
    location /socket.io/  { proxy_pass http://certbuzz_app; proxy_buffering off; }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/certbuzz /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Step 2: Get SSL cert if needed
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
    sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email $EMAIL --redirect
fi

# Step 3: Now write the full SSL config (certbot created the letsencrypt files)
sudo tee /etc/nginx/sites-available/certbuzz >/dev/null <<NGINX
upstream certbuzz_app {
    server localhost:8000;
    keepalive 64;
}
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
$PROXY_SETTINGS
    location /            { proxy_pass http://certbuzz_app; }
    location /socket.io/  { proxy_pass http://certbuzz_app; proxy_buffering off; }
}
NGINX

sudo nginx -t && sudo systemctl reload nginx
EOF
}

# --- Main ---
log "CertBuzz deploy"
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS CLI not configured — run 'aws configure'"

FIRST_DEPLOY=""
ensure_sg
resolve_instance
wait_for_ssh

if [[ "$FIRST_DEPLOY" == "true" ]] || ! ssh_ "command -v node" >/dev/null 2>&1; then
  install_runtime
fi

sync_files
build_and_restart
configure_nginx

echo ""
log "Done!"
echo "    URL: https://$DOMAIN"
echo "    SSH: ssh -i $SSH_KEY ubuntu@$IP"
