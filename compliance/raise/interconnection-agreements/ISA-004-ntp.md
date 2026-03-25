# Interconnection Security Agreement (ISA)

## ISA-004: NTP Time Sources (Time Synchronization)

| Field | Value |
|-------|-------|
| **ISA ID** | ISA-004 |
| **Connected System** | NTP time servers (pool.ntp.org / DoD NTP sources) |
| **System Owner** | NTP Pool Project / DISA (government deployments) |
| **Connection Purpose** | Accurate time synchronization for all cluster nodes to support audit logging, certificate validation, and distributed system coordination |
| **Classification** | Unclassified |
| **Effective Date** | 2025-06-15 |
| **Review Date** | 2026-06-15 |
| **Status** | Active |

---

## 1. Connection Description

All SRE Platform cluster nodes synchronize time via NTP (Network Time Protocol) using chronyd. Accurate time is a foundational requirement for:

1. **Audit log correlation**: All log timestamps must be synchronized across nodes for forensic analysis (AU-8).
2. **Certificate validation**: TLS certificate validity checks depend on accurate system time (SC-12).
3. **Distributed system coordination**: etcd, Raft consensus, and Kubernetes lease mechanisms require time agreement.
4. **FIPS compliance**: NIST SP 800-53 AU-8 requires reliable time sources.

## 2. Connection Details

| Parameter | Value |
|-----------|-------|
| **Protocol** | NTP (UDP) |
| **Port** | 123 |
| **Direction** | Outbound (cluster nodes to NTP servers) |
| **Client** | chronyd (configured via Ansible os-hardening role) |
| **Stratum** | Stratum 1-2 servers from pool.ntp.org (or DoD NTP sources) |
| **Sync Interval** | Adaptive (64s - 1024s based on clock drift) |
| **Accuracy** | Sub-millisecond with Stratum 1 sources |

### NTP Sources (configurable)

| Environment | Sources |
|-------------|---------|
| Commercial | 0.pool.ntp.org, 1.pool.ntp.org, 2.pool.ntp.org, 3.pool.ntp.org |
| Government | DISA NTP servers (site-specific configuration) |
| Air-gapped | Local GPS-disciplined NTP server or hardware clock |

## 3. Data Transmitted

| Data Type | Direction | Classification | Description |
|-----------|-----------|---------------|-------------|
| NTP request | Node -> Server | Unclassified | Timestamp request packet |
| NTP response | Server -> Node | Unclassified | Timestamp response with server time |

**Data NOT transmitted:**
- No system identification information
- No network topology data
- No authentication credentials (NTS authentication optional)

## 4. Security Controls

| Control | Implementation |
|---------|---------------|
| **Time Source Authentication** | NTS (Network Time Security) supported by chronyd for authenticated time (AU-8) |
| **Drift Monitoring** | Prometheus node_exporter metrics track NTP offset and sync status (SI-4) |
| **Redundancy** | Multiple NTP sources configured; chronyd selects best source (CP-2) |
| **Firewall** | Outbound UDP 123 only; no inbound NTP accepted (SC-7) |
| **OS Hardening** | chronyd configured via Ansible STIG role with restricted permissions (CM-6) |
| **Alerting** | Prometheus alert fires when NTP offset exceeds 100ms (AU-5) |

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| NTP server compromise delivers wrong time | Very Low | High | Multiple sources; chronyd uses majority voting |
| NTP traffic blocked by network change | Low | Medium | Prometheus alerts on time drift; multiple source fallback |
| Clock drift during NTP outage | Low | Low | chronyd maintains drift estimate; hardware clock provides short-term stability |
| NTP amplification attack via cluster | Very Low | Low | chronyd configured as client only; no NTP server exposed |

## 6. Residual Risk

**Accepted Risk:** NTP traffic is unencrypted by default. Mitigated by NTS support in chronyd and multiple source voting to detect tampered responses. Government deployments should use authenticated DoD NTP sources.

## 7. NIST Control Mapping

- **AU-8**: Accurate timestamps on all audit records via synchronized clocks
- **AU-8(1)**: Comparison with authoritative time source (NTP Stratum 1-2)
- **SC-7**: Outbound-only NTP connections through restricted firewall rules
- **SI-4**: Continuous monitoring of NTP synchronization via Prometheus

## 8. Points of Contact

| Role | Name | Organization |
|------|------|-------------|
| Infrastructure Admin | Platform Team Lead | SRE Platform Team |
| Network Security | Security Engineer | SRE Security Team |

---

*Last reviewed: 2025-06-15*
*Next review due: 2026-06-15*
