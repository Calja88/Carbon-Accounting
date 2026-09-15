-- Synthetic fixtures only. The runner wraps this file in BEGIN / ROLLBACK.
-- No seed, real official workbook, calculation, activation or report writes.
CREATE FUNCTION of_test_failure(statement TEXT, expected_constraint TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE actual TEXT;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN integrity_constraint_violation THEN
    GET STACKED DIAGNOSTICS actual = CONSTRAINT_NAME;
    IF expected_constraint <> '' AND actual IS DISTINCT FROM expected_constraint THEN
      RAISE EXCEPTION 'Wrong constraint: expected %, got %', expected_constraint, actual;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected integrity failure did not occur';
END $$;

INSERT INTO "User" (id,name,email,"passwordHash",role,"createdAt") VALUES
 ('of-test-author','Synthetic schema test','of-test-author@example.invalid','not-a-login','ADMIN',now()),
 ('of-test-reviewer','Synthetic schema reviewer','of-test-reviewer@example.invalid','not-a-login','ADMIN',now());
INSERT INTO of_registry (id,namespace,"publisherCode","datasetFamily","applicationDomain","geographyProfile")
 VALUES ('of-test-registry','of-test-namespace','TEST','SYNTHETIC','CORPORATE','GB');
INSERT INTO of_release (id,"registryId","reportingYear","revisionKey","publisherName","sourceUrl","revisionEvidence","createdByUserId")
 VALUES ('of-test-release','of-test-registry',2026,'synthetic-v1','TEST','https://example.invalid','Synthetic evidence','of-test-author');
INSERT INTO of_artifact (id,sha256,"byteSize","firstFileName","fileFormat","storageProvider","storageKey","storageVersion","mediaType","firstRetrievedAt","firstSourceUrl","storageState","createdByUserId")
 VALUES ('of-test-artifact',repeat('a',64),1,'synthetic.csv','CSV','TEST','test','v1','text/csv',now(),'https://example.invalid','READY','of-test-author');
INSERT INTO of_release_artifact (id,"releaseId","artifactId","artifactKind","variantKey","fileName","retrievedAt","sourceUrl",role,"claimedByUserId")
 VALUES ('of-test-ra','of-test-release','of-test-artifact','FLAT','en','synthetic.csv',now(),'https://example.invalid','AUTHORITATIVE','of-test-author');
INSERT INTO of_verification (id,"releaseId","inventoryHash","verificationHash","verificationPolicyVersion","verifiedByUserId","verifiedAt",rationale,evidence)
 VALUES ('of-test-verification','of-test-release',repeat('a',64),repeat('a',64),'v1','of-test-reviewer',now(),'Synthetic verification','{}');
INSERT INTO of_parse (id,"releaseArtifactId","parserVersion","sourceProfileVersion","identityVersion","validationVersion","parseKey","parseHash","scannedCount","candidateCount","skippedCount","warningCount","rejectedCount","sheetSummary","createdByUserId")
 VALUES ('of-test-parse','of-test-ra','v1','v1','v1','v1',repeat('a',64),repeat('a',64),1,1,0,0,0,'{}','of-test-author');
INSERT INTO of_identity (id,"releaseId","identityVersion","sourceIdentityHash","canonicalIdentity")
 VALUES ('of-test-identity','of-test-release','v1',repeat('a',64),'synthetic-identity');
INSERT INTO of_source_factor (id,"parseId","identityId",sheet,"sourceRow","sourceColumnKey","rawFactorText","rawNumericToken","numericKind","exactCoefficient","exactExponent","gasMeasure","boundaryClass","cvBasis","rfChoice","sourceQualifiers","rawCells","parseStatus","validationCodes","observationHash","semanticValueHash")
 VALUES ('of-test-source','of-test-parse','of-test-identity','Synthetic',1,'value','0.1','0.1','FINITE','1',-1,'WHOLE_GAS_CO2E','DIRECT','GROSS','NOT_APPLICABLE','{}','{}','VALID','[]',repeat('a',64),repeat('a',64));
UPDATE of_parse SET "sealedAt"=now() WHERE id='of-test-parse';
INSERT INTO of_mapping (id,"identityId","sourceFactorId","targetSlot",revision,decision,"targetCategory","targetSubtypeIdentity","targetUnit","factorBasis","reportingScope","emissionsBoundary","gasMeasure","applicabilityGeography","geographyRationale","cvBasis","qualifierPolicy",transform,"interpretedCoefficient","interpretedExponent","mappingRuleVersion",rationale,"mappedByUserId","mappedAt","mappingHash")
 VALUES ('of-test-mapping','of-test-identity','of-test-source',of_lookup_key('stationary_combustion_natural_gas',null,'STANDARD'),1,'MAPPED','stationary_combustion_natural_gas',of_subtype_key(null),'kWh','STANDARD','SCOPE_1','DIRECT','WHOLE_GAS_CO2E','GB','Synthetic','GROSS','Gross CV synthetic review','IDENTITY','1',-1,'v1','Synthetic','of-test-author',now(),repeat('a',64));
INSERT INTO of_coverage (id,"registryId",revision,"profileName",purpose,"productContractVersion","coverageHash",rationale,"createdByUserId")
 VALUES ('of-test-coverage','of-test-registry',1,'Synthetic','TEST_ONLY','v1',repeat('a',64),'Synthetic','of-test-author');
INSERT INTO of_requirement (id,"coverageContractId","lookupKey",category,"subtypeIdentity",basis,unit,scope,boundary,"gasMeasure",geography,"cvBasis",rationale)
 VALUES ('of-test-requirement','of-test-coverage',of_lookup_key('stationary_combustion_natural_gas',null,'STANDARD'),'stationary_combustion_natural_gas',of_subtype_key(null),'STANDARD','kWh','SCOPE_1','DIRECT','WHOLE_GAS_CO2E','GB','GROSS','Synthetic');

-- Coverage null subtype collision must fail, before the aggregate is sealed.
SELECT of_test_failure($q$INSERT INTO of_requirement SELECT (jsonb_populate_record(NULL::of_requirement,(SELECT to_jsonb(r) FROM of_requirement r WHERE id='of-test-requirement') || '{"id":"of-test-duplicate-requirement"}')).*$q$, 'of_requirement_key_uq');
SELECT of_test_failure($q$INSERT INTO of_requirement SELECT (jsonb_populate_record(NULL::of_requirement,(SELECT to_jsonb(r) FROM of_requirement r WHERE id='of-test-requirement') || '{"id":"of-test-forged-key","lookupKey":"forged"}')).*$q$, 'of_requirement_key_ck');
UPDATE of_coverage SET "sealedAt"=now() WHERE id='of-test-coverage';

INSERT INTO of_manifest (id,"registryId","primaryReleaseId","coverageContractId","baselineGeneration",purpose,"proposedName","applicableFrom","applicableUntil","manifestHash","manifestFormatVersion","validationVersion","mappingRuleVersion","numericPolicyVersion","approvalPolicyVersion","sourceCounts","coverageMetrics","warningSummary","createdByUserId")
 VALUES ('of-test-manifest','of-test-registry','of-test-release','of-test-coverage',0,'TEST_ONLY','Synthetic only','2026-01-01','2027-01-01',repeat('a',64),'v1','v1','v1','v1','v1','{}','{}','{}','of-test-author');
INSERT INTO of_manifest_artifact (id,"manifestId","releaseArtifactId","verificationId","parseId",use,"boundArtifactHash","boundInventoryHash","boundParseHash")
 VALUES ('of-test-ma','of-test-manifest','of-test-ra','of-test-verification','of-test-parse','FACTOR_INPUT',repeat('a',64),repeat('a',64),repeat('a',64));
INSERT INTO of_disposition (id,"manifestId","sourceFactorId",decision,"reasonCode",rationale,"acknowledgedWarningCodes")
 VALUES ('of-test-disposition','of-test-manifest','of-test-source','SELECTED','SYNTHETIC','Synthetic','[]');
-- A manifest without its required output cannot be sealed.
SELECT of_test_failure($q$UPDATE of_manifest SET "sealedAt"=now() WHERE id='of-test-manifest'$q$, '');
INSERT INTO of_manifest_factor (id,"manifestId","coverageRequirementId",origin,"mappingId","dispositionId","rootSourceFactorId","sourceReleaseId","originalSourceName","originalPublisher","originalVintageYear","lookupKey","targetCategory","targetSubtypeIdentity","factorBasis","reportingScope","targetUnit",geography,"emissionsBoundary","gasMeasure","cvBasis","exactCoefficient","exactExponent","candidateValue","itemHash")
 VALUES ('of-test-item','of-test-manifest','of-test-requirement','NEW_OFFICIAL','of-test-mapping','of-test-disposition','of-test-source','of-test-release','Synthetic','TEST',2026,of_lookup_key('stationary_combustion_natural_gas',null,'STANDARD'),'stationary_combustion_natural_gas',of_subtype_key(null),'STANDARD','SCOPE_1','kWh','GB','DIRECT','WHOLE_GAS_CO2E','GROSS','1',-1,0.1,repeat('a',64));
SELECT of_test_failure($q$INSERT INTO of_manifest_factor SELECT (jsonb_populate_record(NULL::of_manifest_factor,(SELECT to_jsonb(f) FROM of_manifest_factor f WHERE id='of-test-item') || '{"id":"of-test-duplicate-item"}')).*$q$, 'of_mf_lookup_uq');
UPDATE of_manifest SET "sealedAt"=now() WHERE id='of-test-manifest';

-- A second proposal permits an independent publication-retry uniqueness test.
INSERT INTO of_manifest SELECT (jsonb_populate_record(NULL::of_manifest,(SELECT to_jsonb(m) FROM of_manifest m WHERE id='of-test-manifest') || jsonb_build_object('id','of-test-manifest-2','manifestHash',repeat('b',64),'sealedAt',null))).*;
INSERT INTO of_manifest_artifact SELECT (jsonb_populate_record(NULL::of_manifest_artifact,(SELECT to_jsonb(a) FROM of_manifest_artifact a WHERE id='of-test-ma') || '{"id":"of-test-ma-2","manifestId":"of-test-manifest-2"}')).*;
INSERT INTO of_disposition SELECT (jsonb_populate_record(NULL::of_disposition,(SELECT to_jsonb(d) FROM of_disposition d WHERE id='of-test-disposition') || '{"id":"of-test-disposition-2","manifestId":"of-test-manifest-2"}')).*;
INSERT INTO of_manifest_factor SELECT (jsonb_populate_record(NULL::of_manifest_factor,(SELECT to_jsonb(f) FROM of_manifest_factor f WHERE id='of-test-item') || '{"id":"of-test-item-2","manifestId":"of-test-manifest-2","dispositionId":"of-test-disposition-2"}')).*;
UPDATE of_manifest SET "sealedAt"=now() WHERE id='of-test-manifest-2';

INSERT INTO of_approval (id,"manifestId",purpose,"subjectHash","approvalPolicyVersion","contributorsHash","approverUserId","approvedAt","expiresAt",rationale) VALUES
 ('of-test-review','of-test-manifest','MANIFEST_REVIEW',repeat('a',64),'v1',repeat('a',64),'of-test-reviewer',now(),now()+interval '1 day','Synthetic'),
 ('of-test-approve','of-test-manifest','PUBLISH',repeat('a',64),'v1',repeat('a',64),'of-test-reviewer',now(),now()+interval '1 day','Synthetic');
-- Legacy synthetic sets are FK fixtures only, not publication service output.
INSERT INTO "EmissionFactorSet" (id,name,publisher,"vintageYear","effectiveFrom","createdAt") VALUES
 ('of-test-set','Synthetic schema FK only','TEST',2026,'2026-01-01',now()),
 ('of-test-set-2','Synthetic schema FK only','TEST',2026,'2026-01-01',now());
INSERT INTO of_publication (id,"manifestId","factorSetId","reviewApprovalId","publishApprovalId","idempotencyKey","requestHash","publishedByUserId","publishedAt","projectionHash","publicationContractVersion")
 VALUES ('of-test-publication','of-test-manifest','of-test-set','of-test-review','of-test-approve','of-test-request',repeat('a',64),'of-test-reviewer',now(),repeat('a',64),'v1');
SELECT of_test_failure($q$INSERT INTO of_publication SELECT (jsonb_populate_record(NULL::of_publication,(SELECT to_jsonb(p) FROM of_publication p WHERE id='of-test-publication') || '{"id":"of-test-publication-duplicate"}')).*$q$, 'of_publication_manifest_uq');
SELECT of_test_failure($q$INSERT INTO of_publication SELECT (jsonb_populate_record(NULL::of_publication,(SELECT to_jsonb(p) FROM of_publication p WHERE id='of-test-publication') || '{"id":"of-test-retry","manifestId":"of-test-manifest-2","factorSetId":"of-test-set-2"}')).*$q$, 'of_publication_retry_uq');

-- Check runtime-key uniqueness using synthetic rows, without calling a publisher.
INSERT INTO "EmissionFactor" (id,"factorSetId",scope,category,basis,unit,"co2eFactor","officialManifestFactorId","publishedLookupKey")
 VALUES ('of-test-runtime','of-test-set','SCOPE_1','stationary_combustion_natural_gas','STANDARD','kWh',0.1,'of-test-item',of_lookup_key('stationary_combustion_natural_gas',null,'STANDARD'));
SELECT of_test_failure($q$INSERT INTO "EmissionFactor" SELECT (jsonb_populate_record(NULL::"EmissionFactor",(SELECT to_jsonb(f) FROM "EmissionFactor" f WHERE id='of-test-runtime') || '{"id":"of-test-runtime-duplicate","officialManifestFactorId":"of-test-item-2"}')).*$q$, 'of_factor_lookup_uq');

SELECT of_test_failure($q$INSERT INTO of_release SELECT (jsonb_populate_record(NULL::of_release,(SELECT to_jsonb(r) FROM of_release r WHERE id='of-test-release') || '{"id":"of-test-release-duplicate"}')).*$q$, 'of_release_key_uq');
SELECT of_test_failure($q$INSERT INTO of_artifact SELECT (jsonb_populate_record(NULL::of_artifact,(SELECT to_jsonb(a) FROM of_artifact a WHERE id='of-test-artifact') || '{"id":"of-test-artifact-duplicate","firstFileName":"renamed.csv"}')).*$q$, 'of_artifact_sha_uq');
SELECT of_test_failure($q$INSERT INTO of_identity SELECT (jsonb_populate_record(NULL::of_identity,(SELECT to_jsonb(i) FROM of_identity i WHERE id='of-test-identity') || '{"id":"of-test-identity-duplicate"}')).*$q$, 'of_identity_key_uq');
SELECT of_test_failure($q$INSERT INTO of_manifest SELECT (jsonb_populate_record(NULL::of_manifest,(SELECT to_jsonb(m) FROM of_manifest m WHERE id='of-test-manifest') || '{"id":"of-test-manifest-duplicate","sealedAt":null}')).*$q$, 'of_manifest_hash_uq');
SELECT of_test_failure($q$INSERT INTO of_mapping SELECT (jsonb_populate_record(NULL::of_mapping,(SELECT to_jsonb(m) FROM of_mapping m WHERE id='of-test-mapping') || '{"id":"of-test-mapping-duplicate"}')).*$q$, 'of_mapping_revision_uq');
SELECT of_test_failure($q$UPDATE of_mapping SET rationale='changed' WHERE id='of-test-mapping'$q$, '');
SELECT of_test_failure($q$UPDATE of_source_factor SET "exactCoefficient"='2' WHERE id='of-test-source'$q$, '');
SELECT of_test_failure($q$INSERT INTO of_disposition SELECT (jsonb_populate_record(NULL::of_disposition,(SELECT to_jsonb(d) FROM of_disposition d WHERE id='of-test-disposition') || '{"id":"of-test-late-disposition"}')).*$q$, '');
SELECT of_test_failure($q$INSERT INTO of_coverage SELECT (jsonb_populate_record(NULL::of_coverage,(SELECT to_jsonb(c) FROM of_coverage c WHERE id='of-test-coverage') || '{"id":"of-test-presealed"}')).*$q$, '');
SELECT of_test_failure($q$INSERT INTO of_mapping SELECT (jsonb_populate_record(NULL::of_mapping,(SELECT to_jsonb(m) FROM of_mapping m WHERE id='of-test-mapping') || '{"id":"of-test-precision","interpretedCoefficient":"123456789","interpretedExponent":-9}')).*$q$, '');

-- Excess precision is storable as source evidence, but not as a mapped runtime candidate.
INSERT INTO of_parse SELECT (jsonb_populate_record(NULL::of_parse,(SELECT to_jsonb(p) FROM of_parse p WHERE id='of-test-parse') || jsonb_build_object('id','of-test-precise-parse','parseKey',repeat('b',64),'parseHash',repeat('b',64),'sealedAt',null))).*;
INSERT INTO of_source_factor SELECT (jsonb_populate_record(NULL::of_source_factor,(SELECT to_jsonb(s) FROM of_source_factor s WHERE id='of-test-source') || '{"id":"of-test-precise-source","parseId":"of-test-precise-parse","rawFactorText":"0.123456789","rawNumericToken":"0.123456789","exactCoefficient":"123456789","exactExponent":-9}')).*;
UPDATE of_parse SET "sealedAt"=now() WHERE id='of-test-precise-parse';
SELECT of_test_failure($q$INSERT INTO of_mapping SELECT (jsonb_populate_record(NULL::of_mapping,(SELECT to_jsonb(m) FROM of_mapping m WHERE id='of-test-mapping') || '{"id":"of-test-precise-map","sourceFactorId":"of-test-precise-source","revision":2,"supersedesMappingId":"of-test-mapping","interpretedCoefficient":"123456789","interpretedExponent":-9}')).*$q$, '');

INSERT INTO of_parse SELECT (jsonb_populate_record(NULL::of_parse,(SELECT to_jsonb(p) FROM of_parse p WHERE id='of-test-parse') || jsonb_build_object('id','of-test-gas-parse','parseKey',repeat('c',64),'parseHash',repeat('c',64),'sealedAt',null))).*;
INSERT INTO of_source_factor SELECT (jsonb_populate_record(NULL::of_source_factor,(SELECT to_jsonb(s) FROM of_source_factor s WHERE id='of-test-source') || '{"id":"of-test-gas-source","parseId":"of-test-gas-parse","gasMeasure":"GAS_CONTRIBUTION_CO2E"}')).*;
UPDATE of_parse SET "sealedAt"=now() WHERE id='of-test-gas-parse';
-- The numeric value, CV and boundary match: gas classification alone must block this.
SELECT of_test_failure($q$INSERT INTO of_mapping SELECT (jsonb_populate_record(NULL::of_mapping,(SELECT to_jsonb(m) FROM of_mapping m WHERE id='of-test-mapping') || '{"id":"of-test-gas-map","sourceFactorId":"of-test-gas-source","revision":2,"supersedesMappingId":"of-test-mapping"}')).*$q$, '');

INSERT INTO of_plan (id,"registryId",revision,"expectedGeneration","planHash","activationPolicyVersion","createdByUserId",reason)
 VALUES ('of-test-plan','of-test-registry',1,0,repeat('a',64),'v1','of-test-author','Schema interval test only');
INSERT INTO of_window (id,"planId","factorSetId","fromInclusive","untilExclusive",rationale)
 VALUES ('of-test-window','of-test-plan','of-test-set','2026-01-01','2026-07-01','Synthetic interval');
SELECT of_test_failure($q$INSERT INTO of_window (id,"planId","factorSetId","fromInclusive","untilExclusive",rationale) VALUES ('of-test-overlap','of-test-plan','of-test-set','2026-06-01','2026-08-01','Overlap')$q$, 'of_window_no_overlap_excl');
INSERT INTO of_window (id,"planId","factorSetId","fromInclusive","untilExclusive",rationale)
 VALUES ('of-test-adjacent','of-test-plan','of-test-set','2026-07-01','2027-01-01','Adjacent interval');
UPDATE of_plan SET "sealedAt"=now() WHERE id='of-test-plan';

-- Check deferred seals now; the runner still rolls the entire test transaction back.
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 IF of_exact_decimal('123456789',-9) <> 0.123456789 OR of_subtype_key(null)=of_subtype_key('null') THEN RAISE EXCEPTION 'Exact/key contract mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM of_registry WHERE id='of-test-registry' AND (mode<>'LEGACY' OR "currentPlanId" IS NOT NULL OR generation<>0)) THEN RAISE EXCEPTION 'Test unexpectedly activated a set'; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname LIKE 'of_%' AND octet_length(conname)>63) THEN RAISE EXCEPTION 'Overlong constraint name'; END IF;
END $$;
