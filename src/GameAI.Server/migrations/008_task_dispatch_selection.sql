SET search_path=gameai,public;
ALTER TABLE tasks ADD COLUMN dispatch_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN dispatch_revision integer NOT NULL DEFAULT 0 CHECK(dispatch_revision>=0);
ALTER TABLE tasks ADD COLUMN dispatch_selected_by uuid REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN dispatch_selected_at timestamptz;
ALTER TABLE tasks ADD CONSTRAINT dispatch_selection_child_only CHECK(
    NOT dispatch_allowed OR (parent_id IS NOT NULL AND role_code<>'PM' AND dispatch_selected_by IS NOT NULL AND dispatch_selected_at IS NOT NULL));
