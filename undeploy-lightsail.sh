#!/bin/bash
set -e

REGION="eu-central-1"

echo "=== Remove All Lightsail Resources (${REGION}) ==="

aws sts get-caller-identity &>/dev/null || { echo "Run 'aws configure' first"; exit 1; }

# Delete all instances
echo "--- Instances ---"
INSTANCES=$(aws lightsail get-instances --region $REGION --query 'instances[].name' --output text 2>/dev/null) || true
if [ -n "$INSTANCES" ] && [ "$INSTANCES" != "None" ]; then
    for name in $INSTANCES; do
        echo "Deleting instance: $name"
        aws lightsail delete-instance --instance-name "$name" --region $REGION
    done
else
    echo "No instances found."
fi

# Delete all static IPs
echo "--- Static IPs ---"
STATIC_IPS=$(aws lightsail get-static-ips --region $REGION --query 'staticIps[].name' --output text 2>/dev/null) || true
if [ -n "$STATIC_IPS" ] && [ "$STATIC_IPS" != "None" ]; then
    for name in $STATIC_IPS; do
        echo "Releasing static IP: $name"
        aws lightsail release-static-ip --static-ip-name "$name" --region $REGION
    done
else
    echo "No static IPs found."
fi

# Delete all databases
echo "--- Databases ---"
DBS=$(aws lightsail get-relational-databases --region $REGION --query 'relationalDatabases[].relationalDatabaseName' --output text 2>/dev/null) || true
if [ -n "$DBS" ] && [ "$DBS" != "None" ]; then
    for name in $DBS; do
        echo "Deleting database: $name (skipping final snapshot)"
        aws lightsail delete-relational-database --relational-database-name "$name" --skip-final-snapshot --region $REGION
    done
else
    echo "No databases found."
fi

# Delete all load balancers
echo "--- Load Balancers ---"
LBS=$(aws lightsail get-load-balancers --region $REGION --query 'loadBalancers[].name' --output text 2>/dev/null) || true
if [ -n "$LBS" ] && [ "$LBS" != "None" ]; then
    for name in $LBS; do
        echo "Deleting load balancer: $name"
        aws lightsail delete-load-balancer --load-balancer-name "$name" --region $REGION
    done
else
    echo "No load balancers found."
fi

# Delete all disks
echo "--- Disks ---"
DISKS=$(aws lightsail get-disks --region $REGION --query 'disks[].name' --output text 2>/dev/null) || true
if [ -n "$DISKS" ] && [ "$DISKS" != "None" ]; then
    for name in $DISKS; do
        echo "Deleting disk: $name"
        aws lightsail delete-disk --disk-name "$name" --region $REGION
    done
else
    echo "No disks found."
fi

# Delete all container services
echo "--- Container Services ---"
CONTAINERS=$(aws lightsail get-container-services --region $REGION --query 'containerServices[].containerServiceName' --output text 2>/dev/null) || true
if [ -n "$CONTAINERS" ] && [ "$CONTAINERS" != "None" ]; then
    for name in $CONTAINERS; do
        echo "Deleting container service: $name"
        aws lightsail delete-container-service --service-name "$name" --region $REGION
    done
else
    echo "No container services found."
fi

# Delete all distributions (CDN)
echo "--- Distributions ---"
DISTS=$(aws lightsail get-distributions --region $REGION --query 'distributions[].name' --output text 2>/dev/null) || true
if [ -n "$DISTS" ] && [ "$DISTS" != "None" ]; then
    for name in $DISTS; do
        echo "Deleting distribution: $name"
        aws lightsail delete-distribution --distribution-name "$name" --region $REGION
    done
else
    echo "No distributions found."
fi

# Delete all key pairs (Lightsail-managed only)
echo "--- Key Pairs ---"
KEYS=$(aws lightsail get-key-pairs --region $REGION --query 'keyPairs[].name' --output text 2>/dev/null) || true
if [ -n "$KEYS" ] && [ "$KEYS" != "None" ]; then
    for name in $KEYS; do
        echo "Deleting key pair: $name"
        aws lightsail delete-key-pair --key-pair-name "$name" --region $REGION 2>/dev/null || echo "  (could not delete, may be default)"
    done
else
    echo "No key pairs found."
fi

echo ""
echo "=== Done ==="
echo "All Lightsail resources in ${REGION} have been removed."
