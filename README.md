# Full Revaluation Engine (Bonds + European Options) — Java, Oracle, AWS

Portfolio-level VaR calculated by **full revaluation**: every instrument is
repriced from scratch under every market scenario (no delta/gamma
approximation), the same approach a bank's market risk system uses for
Full Revaluation batch runs.

## What it does

1. You load a portfolio of bonds and European options.
2. You generate (or later, load real historical) market scenarios: shocks to
   rates, spot, and vol.
3. The engine reprices every instrument under every scenario, computes P&L
   per scenario, and derives portfolio VaR at a given confidence level.

## Stack

| Layer          | Technology                                          |
|----------------|------------------------------------------------------|
| Backend        | Java 17, Spring Boot 3, Spring Data JPA               |
| Database       | Oracle (Amazon RDS for Oracle in prod, H2 for local)  |
| Compute        | AWS Elastic Beanstalk (Corretto platform) or EC2      |
| Frontend       | React (static build), hosted on S3 + CloudFront       |
| Pricing        | Discounted cashflow (bonds), Black-Scholes (options)  |

## Project layout

```
full-revaluation/
├── pom.xml
├── src/main/java/com/martin/fullreval/
│   ├── model/           # Instrument (base), Bond, EuropeanOption, MarketScenario, RevaluationResult
│   ├── repository/      # Spring Data JPA repositories
│   ├── service/
│   │   ├── RevaluationService.java     # orchestrates the full revaluation run
│   │   └── pricing/BlackScholesPricer.java
│   ├── controller/       # REST API: portfolios, scenarios, revaluation runs
│   └── dto/
├── src/main/resources/application.yml
├── sql/schema.sql        # Oracle DDL — run this against RDS before first boot
├── infra/
│   ├── rds-oracle.yaml   # CloudFormation for the RDS Oracle instance
│   └── eb-env.config     # Elastic Beanstalk environment settings
└── frontend/src/App.jsx  # minimal dashboard: trigger a run, view VaR
```

## Running locally (no AWS, no cost)

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

This uses an in-memory H2 database in Oracle compatibility mode, so you can
develop and test the whole flow without paying for RDS.

## Deploying to AWS

There are two database options, trading managed convenience for cost:

### Option A — RDS Oracle (managed, but Oracle license is never free)
`infra/rds-oracle.yaml`. RDS Free Tier does **not** cover Oracle under any
circumstance (only MariaDB, MySQL, PostgreSQL, SQL Server Express) — the
License Included model bills roughly 0.03-0.05 USD/hour on top of the
instance cost, continuously, until you delete the stack.
```bash
aws cloudformation create-stack --stack-name fullreval-db \
  --template-body file://infra/rds-oracle.yaml \
  --parameters ParameterKey=DBMasterPassword,ParameterValue=<strong-password> \
               ParameterKey=VpcId,ParameterValue=<vpc-id> \
               ParameterKey=SubnetIds,ParameterValue=<subnet-1>\\,<subnet-2> \
               ParameterKey=AllowedIngressCidr,ParameterValue=<your-cidr>
```

### Option B — EC2 + Oracle Database Free (the cheaper option)
`infra/ec2-oracle-free.yaml`. Oracle Database Free has **no license cost**
at all; the only spend is the EC2 instance itself, which can fall under the
AWS Free Tier for new accounts (750 hrs/month of t3.micro/t4g.micro for 12
months), or a few cents/hour otherwise if you stop it when not in use.
```bash
aws cloudformation create-stack --stack-name fullreval-db \
  --template-body file://infra/ec2-oracle-free.yaml \
  --parameters ParameterKey=VpcId,ParameterValue=<vpc-id> \
               ParameterKey=SubnetId,ParameterValue=<public-subnet> \
               ParameterKey=KeyPairName,ParameterValue=<your-keypair> \
               ParameterKey=AllowedSshCidr,ParameterValue=<your-ip>/32 \
               ParameterKey=AllowedAppCidr,ParameterValue=<app-tier-cidr> \
               ParameterKey=OraclePassword,ParameterValue=<strong-password>
```
Note: Oracle's download page normally requires accepting a license in a
browser before the installer is servable, so before launching you'll need
to grab a signed download URL from https://www.oracle.com/database/free/
and paste it into the template's `UserData` section (marked with a
`REPLACE_WITH_SIGNED_ORACLE_DOWNLOAD_URL` placeholder). This is a
restriction from Oracle's own distribution terms, not an AWS limitation.
Once installed, the service name is `FREEPDB1` on port 1521.

2. Run `sql/schema.sql` against whichever endpoint you chose (SQL*Plus, SQL
   Developer, or any Oracle-compatible client).
3. **Backend**: `mvn package`, then `eb init` / `eb create` with
   `infra/eb-env.config` placed under `.ebextensions/`, filling in the real
   `DB_HOST` from the CloudFormation output and setting `DB_PASSWORD` via
   `eb setenv` (never commit it).
4. **Frontend**: `npm run build` in `frontend/`, then sync the build output
   to an S3 bucket configured for static website hosting (optionally behind
   CloudFront for HTTPS).

## Cost control

RDS Oracle is the expensive piece (license-included, billed even when the
instance is stopped due to storage). Recommended workflow: stand the stack
up, use it for as long as you need it, then `aws cloudformation delete-stack`
when done. Re-create it from the template whenever you need it again.

## Possible extensions

- Swap the synthetic scenario generator for real historical curve/spot/vol
  moves (e.g. pulled from a public market data API).
- Move the instrument x scenario pricing loop from in-process
  `CompletableFuture` parallelism to AWS Batch or Lambda for the scale a real
  overnight risk run needs.
- Add PL/SQL stored procedures for the percentile/VaR aggregation, moving
  that computation to the database side instead of Java.
